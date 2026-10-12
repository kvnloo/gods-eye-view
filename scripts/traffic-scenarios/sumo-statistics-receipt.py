#!/usr/bin/env python3
"""Convert one SUMO statistics XML output into a bounded simulation-only GEV receipt.

No SUMO dependency, network access, vehicles' identities, signal writes or video.
The metadata is operator-attested; the XML cannot prove routes, seed or TLS plan.
"""

import argparse
from decimal import Decimal, InvalidOperation
import hashlib
import json
import math
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

MAX_INPUT_BYTES = 2_000_000
CONTEXT_STRINGS = (
    'networkRevision', 'demandRevision', 'inputEvidenceRevision',
    'simulatorId', 'simulatorVersion', 'evaluationRevision',
)
CONTEXT_NUMBERS = ('randomSeed', 'windowStartMs', 'windowEndMs')
VEHICLE_METRICS = {
    'meanVehicleTimeLossSeconds': 'timeLoss',
    'meanVehicleTripDurationSeconds': 'duration',
    'totalVehicleTravelTimeSeconds': 'totalTravelTime',
    'totalVehicleDepartDelaySeconds': 'totalDepartDelay',
}


def require_id(value, label):
    if not isinstance(value, str) or not value or value.strip() != value or len(value) > 128:
        raise ValueError(f'{label}: non-empty bounded identifier required')
    return value


def nonnegative_decimal(value, label):
    if value is None:
        raise ValueError(f'{label}: missing')
    try:
        number = Decimal(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValueError(f'{label}: invalid numeric value') from exc
    if not number.is_finite() or number < 0:
        raise ValueError(f'{label}: must be finite and nonnegative')
    return number


def nonnegative_int(value, label):
    number = nonnegative_decimal(value, label)
    if number != int(number):
        raise ValueError(f'{label}: must be an integer')
    return int(number)


def safe_number(value, label):
    number = nonnegative_decimal(value, label)
    result = float(number)
    if not math.isfinite(result):
        raise ValueError(f'{label}: out of range')
    return result


def read_limited(path):
    file = Path(path)
    if file.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError('input exceeds 2 MB limit')
    data = file.read_bytes()
    if len(data) > MAX_INPUT_BYTES:
        raise ValueError('input exceeds 2 MB limit')
    return data


def metadata_context(metadata):
    if not isinstance(metadata, dict):
        raise ValueError('metadata object required')
    require_id(metadata.get('runId'), 'runId')
    require_id(metadata.get('planRevision'), 'planRevision')
    context = metadata.get('context')
    if not isinstance(context, dict):
        raise ValueError('context object required')
    for key in CONTEXT_STRINGS:
        require_id(context.get(key), key)
    if context['simulatorId'] != 'sumo':
        raise ValueError('simulatorId must be sumo')
    for key in CONTEXT_NUMBERS:
        value = context.get(key)
        if type(value) is not int or value < 0 or value > 2**53 - 1:
            raise ValueError(f'{key}: nonnegative safe integer required')
    if context['windowEndMs'] <= context['windowStartMs']:
        raise ValueError('simulation window must be positive')
    # Explicit policy attestation, even when no unfinished vehicles are expected.
    if metadata.get('sumoOptions') != {
        'tripinfoOutputWriteUnfinished': True,
        'durationLogStatistics': True,
    }:
        raise ValueError('requires explicit SUMO unfinished/statistics option attestations')
    return context


def single_child(root, name):
    matches = root.findall(name)
    if len(matches) != 1:
        raise ValueError(f'one <{name}> element required')
    return matches[0]


def build_receipt(metadata, xml_bytes):
    context = metadata_context(metadata)
    if len(xml_bytes) > MAX_INPUT_BYTES or b'<!DOCTYPE' in xml_bytes.upper():
        raise ValueError('oversized or DTD-containing XML is not accepted')
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as exc:
        raise ValueError('invalid SUMO statistics XML') from exc
    if root.tag != 'statistics':
        raise ValueError('SUMO <statistics> root required')
    performance = single_child(root, 'performance')
    vehicles = single_child(root, 'vehicles')
    trips = single_child(root, 'vehicleTripStatistics')
    teleports = single_child(root, 'teleports')

    for field, key in [('begin', 'windowStartMs'), ('end', 'windowEndMs')]:
        value = nonnegative_decimal(performance.get(field), f'performance.{field}') * 1000
        if value != context[key]:
            raise ValueError(f'performance.{field} does not match context.{key}')

    counts = {
        'loaded': nonnegative_int(vehicles.get('loaded'), 'vehicles.loaded'),
        'inserted': nonnegative_int(vehicles.get('inserted'), 'vehicles.inserted'),
        'running': nonnegative_int(vehicles.get('running'), 'vehicles.running'),
        'waiting': nonnegative_int(vehicles.get('waiting'), 'vehicles.waiting'),
        'tripStatisticsCount': nonnegative_int(trips.get('count'), 'vehicleTripStatistics.count'),
    }
    total_teleports = nonnegative_int(teleports.get('total'), 'teleports.total')
    if counts['inserted'] > counts['loaded'] or counts['tripStatisticsCount'] > counts['inserted']:
        raise ValueError('inconsistent vehicle counts in SUMO output')

    reasons = []
    if counts['inserted'] == 0:
        reasons.append('no-inserted-vehicles')
    if counts['loaded'] != counts['inserted']:
        reasons.append('not-all-vehicles-inserted')
    if counts['running'] or counts['waiting']:
        reasons.append('unfinished-or-waiting-vehicles')
    if counts['tripStatisticsCount'] != counts['inserted']:
        reasons.append('incomplete-trip-statistics')
    if total_teleports:
        reasons.append('simulator-teleports')

    # SUMO exposes these independent safety counters in <safety>. Check
    # them before emitting any performance metric: the caller may persist
    # this receipt even when the surrounding experiment ultimately fails.
    safety_counts = None
    safety_elements = root.findall('safety')
    if len(safety_elements) != 1:
        reasons.append('missing-safety-evidence')
    else:
        safety = safety_elements[0]
        try:
            safety_counts = {
                'collisions': nonnegative_int(
                    safety.get('collisions'), 'safety.collisions'
                ),
                'emergencyStops': nonnegative_int(
                    safety.get('emergencyStops'), 'safety.emergencyStops'
                ),
            }
        except ValueError:
            reasons.append('invalid-safety-evidence')
        else:
            if safety_counts['collisions']:
                reasons.append('simulator-collisions')
            if safety_counts['emergencyStops']:
                reasons.append('simulator-emergency-stops')

    measures = {}
    for metric, attribute in VEHICLE_METRICS.items():
        raw = trips.get(attribute)
        if raw is None:
            reasons.append(f'missing-{attribute}')
            continue
        measures[metric] = safe_number(raw, f'vehicleTripStatistics.{attribute}')

    # Suppress *all* comparison metrics on censored or incomplete runs. A
    # plausible low average from only completed trips is NOT an improvement.
    coverage = 'complete' if not reasons else 'partial'
    return {
        'runId': metadata['runId'],
        'planRevision': metadata['planRevision'],
        'determination': 'simulated',
        'sourceRef': 'sha256:' + hashlib.sha256(xml_bytes).hexdigest(),
        'context': {key: context[key] for key in (*CONTEXT_STRINGS, *CONTEXT_NUMBERS)},
        'metrics': measures if coverage == 'complete' else {},
        'quality': {
            'sourceFormat': 'sumo-statistics',
            'coverage': coverage,
            'reasonCodes': reasons,
            'vehicleCounts': counts,
            'teleports': total_teleports,
            'safety': safety_counts,
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', required=True, help='JSON run manifest (operator-attested)')
    parser.add_argument('--statistics', required=True, help='SUMO --statistic-output XML')
    parser.add_argument('--output', help='Optional output JSON file; stdout otherwise')
    args = parser.parse_args(argv)
    try:
        metadata = json.loads(read_limited(args.metadata))
        receipt = build_receipt(metadata, read_limited(args.statistics))
        encoded = json.dumps(receipt, indent=2, sort_keys=True) + '\n'
        if args.output:
            Path(args.output).write_text(encoded, encoding='utf-8')
        else:
            sys.stdout.write(encoded)
    except (ValueError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        parser.exit(2, f'cannot normalize SUMO statistics: {exc}\n')


if __name__ == '__main__':
    main()
