#!/usr/bin/env python3
"""Run real SUMO on an explicitly synthetic three-signal corridor.

Only an installed simulator may produce outputs: there is no canned-result
fallback. All three paired seeds are reported, even when actuation is worse.
This is a software integration benchmark, not an actual city or field study.
"""

import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

SEEDS = (7, 19, 41)
END_SECONDS = 1800
DEMAND_SECONDS = 600
EXPECTED_VERSION = '1.24.0'
HERE = Path(__file__).resolve().parent


def digest(path):
    return 'sha256:' + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True,
                                    allow_nan=False) + '\n', encoding='utf-8')


def write_xml(path, root):
    ET.indent(root, space='  ')
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


def run_command(args, log, *, allowed=(0,)):
    result = subprocess.run([str(a) for a in args], capture_output=True,
                            text=True, timeout=180, check=False)
    Path(log).write_text(json.dumps([str(a) for a in args]) + '\n' +
                         result.stdout + '\n' + result.stderr, encoding='utf-8')
    if result.returncode not in allowed:
        raise RuntimeError(f'{Path(str(args[0])).name} exited {result.returncode}; see {log}')
    return result


def check_binary(name, out):
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f'{name} is required; no simulator fallback is provided')
    output = run_command([executable, '--version'], out / f'{name}-version.log')
    match = re.search(r'Version\s+v?(\d+\.\d+\.\d+)', output.stdout)
    if not match or match.group(1) != EXPECTED_VERSION:
        raise RuntimeError(f'{name} must be pinned to {EXPECTED_VERSION}')
    return executable


def build_inputs(out):
    """Author a synthetic straight-only corridor, independent of OSM feeds."""
    nodes = ET.Element('nodes')
    for i in range(5):
        ET.SubElement(nodes, 'node', id=f'J{i}', x=str(300 * i), y='0',
                      type='traffic_light' if i in (1, 2, 3) else 'priority')
    for i in (1, 2, 3):
        for side, y in [('N', 200), ('S', -200)]:
            ET.SubElement(nodes, 'node', id=f'{side}{i}', x=str(300 * i),
                          y=str(y), type='priority')
    edges = ET.Element('edges')

    def edge(ident, start, end, priority):
        ET.SubElement(edges, 'edge', {'id': ident, 'from': start, 'to': end,
                      'numLanes': '1', 'speed': '13.89', 'priority': str(priority)})

    for i in range(4):
        edge(f'm{i}e', f'J{i}', f'J{i+1}', 3)
        edge(f'm{i}w', f'J{i+1}', f'J{i}', 3)
    connections = ET.Element('connections')
    routes = {'east': 'm0e m1e m2e m3e', 'west': 'm3w m2w m1w m0w'}
    for i in (1, 2, 3):
        for side in ('N', 'S'):
            edge(f'{side}{i}in', f'{side}{i}', f'J{i}', 1)
            edge(f'{side}{i}out', f'J{i}', f'{side}{i}', 1)
        for first, second in [(f'm{i-1}e', f'm{i}e'),
                              (f'm{i}w', f'm{i-1}w'),
                              (f'N{i}in', f'S{i}out'),
                              (f'S{i}in', f'N{i}out')]:
            ET.SubElement(connections, 'connection', {'from': first, 'to': second,
                                                     'fromLane': '0', 'toLane': '0'})
        routes[f'north{i}'] = f'S{i}in N{i}out'
        routes[f'south{i}'] = f'N{i}in S{i}out'
    for name, root in [('nodes', nodes), ('edges', edges), ('connections', connections)]:
        write_xml(out / f'{name}.xml', root)
    return routes


def write_demand(path, routes, seed):
    rng = random.Random(seed)
    root = ET.Element('routes')
    ET.SubElement(root, 'vType', id='car', vClass='passenger', accel='2.6',
                  decel='4.5', sigma='0.5', length='5', minGap='2.5',
                  maxSpeed='13.89', speedFactor='1.0')
    departures = []
    for name, edges in routes.items():
        ET.SubElement(root, 'route', id=name, edges=edges)
        rate = 600 if name == 'east' else 300 if name == 'west' else 120
        time = rng.expovariate(rate / 3600)
        while time < DEMAND_SECONDS:
            departures.append((round(time, 2), name))
            time += rng.expovariate(rate / 3600)
    departures.sort()
    for i, (time, route) in enumerate(departures):
        ET.SubElement(root, 'vehicle', id=f'synthetic-{seed}-{i}', type='car',
                      route=route, depart=f'{time:.2f}', departLane='0', departSpeed='max')
    write_xml(path, root)
    return len(departures)


def write_plan(network, output, mode):
    """Change timing only; preserve netconvert's link indices and clearances."""
    root = ET.Element('additional')
    logics = ET.parse(network).getroot().findall('tlLogic')
    if {logic.get('id') for logic in logics} != {'J1', 'J2', 'J3'}:
        raise ValueError('expected exactly three generated traffic signals')
    for original in logics:
        logic = copy.deepcopy(original)
        logic.set('programID', f'experiment-{mode}')
        logic.set('type', 'actuated' if mode == 'actuated' else 'static')
        logic.set('offset', '0')
        if mode == 'actuated':
            for phase in logic.findall('phase'):
                if any(c in phase.get('state', '') for c in 'Gg'):
                    phase.set('minDur', '8')
                    phase.set('maxDur', '50')
        root.append(logic)
    write_xml(output, root)


def require_coverage(receipt, statistics, expected_count):
    """Abort on lost demand or simulation safety faults, without a 'win' score."""
    quality = receipt.get('quality', {})
    counts = quality.get('vehicleCounts', {})
    if quality.get('coverage') != 'complete' or counts.get('loaded') != expected_count:
        raise ValueError('incomplete/missing demand; performance comparison withheld')
    root = ET.parse(statistics).getroot()
    safety = root.find('safety')
    if safety is None or safety.get('collisions') != '0' or safety.get('emergencyStops') != '0':
        raise ValueError('simulation safety fault or missing safety evidence; comparison withheld')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(argv)
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {'schemaVersion': 1, 'status': 'failed', 'determination': 'simulated',
              'scenario': 'synthetic-three-signal-corridor', 'seeds': list(SEEDS),
              'sumoVersion': EXPECTED_VERSION, 'runnerRevision': digest(__file__),
              'pairs': []}
    try:
        sumo = check_binary('sumo', out)
        netconvert = check_binary('netconvert', out)
        node = shutil.which('node')
        if not node:
            raise RuntimeError('Node.js required for the actual GEV comparator')
        node_version = run_command([node, '--version'], out / 'node-version.log').stdout.strip()
        if not (re.fullmatch(r'v24\.14\.\d+', node_version) or
                re.fullmatch(r'v26\.\d+\.\d+', node_version)):
            raise RuntimeError('use GEV-supported Node 24.14.x or 26.x')
        report['nodeVersion'] = node_version
        spec = importlib.util.spec_from_file_location('sumo_receipt', HERE / 'sumo-statistics-receipt.py')
        importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(importer)
        routes = build_inputs(out)
        network = out / 'corridor.net.xml'
        run_command([netconvert, '--node-files', out / 'nodes.xml', '--edge-files',
                     out / 'edges.xml', '--connection-files', out / 'connections.xml',
                     '--no-turnarounds', 'true', '--tls.cycle.time', '60',
                     '--tls.yellow.time', '3', '--tls.allred.time', '1',
                     '--output-file', network], out / 'netconvert.log')
        plans = {mode: out / f'{mode}.add.xml' for mode in ('fixed', 'actuated')}
        for mode, path in plans.items():
            write_plan(network, path, mode)
        for seed in SEEDS:
            demand = out / f'demand-{seed}.rou.xml'
            expected_count = write_demand(demand, routes, seed)
            context = {'networkRevision': digest(network), 'demandRevision': digest(demand),
                       'inputEvidenceRevision': 'synthetic:three-signal-poisson-v1',
                       'simulatorId': 'sumo', 'simulatorVersion': EXPECTED_VERSION,
                       'evaluationRevision': digest(__file__), 'randomSeed': seed,
                       'windowStartMs': 0, 'windowEndMs': END_SECONDS * 1000}
            paths = {}
            for mode, plan in plans.items():
                prefix = out / f'{mode}-{seed}'
                statistics = Path(f'{prefix}.statistics.xml')
                command = [sumo, '--net-file', network, '--route-files', demand,
                           '--additional-files', plan, '--begin', '0', '--end', str(END_SECONDS),
                           '--seed', str(seed), '--time-to-teleport', '-1', '--no-step-log', 'true',
                           '--duration-log.statistics', 'true', '--tripinfo-output.write-unfinished',
                           'true', '--statistic-output', statistics]
                run_command(command, f'{prefix}.log')
                metadata = {'runId': f'{mode}-{seed}', 'planRevision': digest(plan),
                            'sumoOptions': {'tripinfoOutputWriteUnfinished': True,
                                            'durationLogStatistics': True}, 'context': context}
                write_json(f'{prefix}.meta.json', metadata)
                receipt = importer.build_receipt(metadata, statistics.read_bytes())
                write_json(f'{prefix}.receipt.json', receipt)
                require_coverage(receipt, statistics, expected_count)
                paths[mode] = Path(f'{prefix}.receipt.json')
                # Detect drift during either process, not just before the pair.
                if digest(network) != context['networkRevision'] or digest(demand) != context['demandRevision']:
                    raise ValueError('network/demand changed during the paired experiment')
            result = run_command([node, HERE / 'compare-sumo-receipts.mjs',
                                  paths['fixed'], paths['actuated']], out / f'compare-{seed}.log')
            comparison = json.loads(result.stdout)
            if comparison.get('status') != 'comparable':
                raise ValueError('GEV withheld comparison')
            write_json(out / f'comparison-{seed}.json', comparison)
            report['pairs'].append({'seed': seed, 'vehicleCount': expected_count,
                                    'comparison': comparison})
        # Real failed-run control: stop the same demand early; do not fabricate XML.
        prefix = out / 'incomplete-control'
        run_command([sumo, '--net-file', network, '--route-files', demand,
                     '--additional-files', plans['fixed'], '--begin', '0', '--end', '30',
                     '--seed', str(SEEDS[-1]), '--time-to-teleport', '-1', '--no-step-log', 'true',
                     '--duration-log.statistics', 'true', '--tripinfo-output.write-unfinished', 'true',
                     '--statistic-output', f'{prefix}.statistics.xml'], f'{prefix}.log')
        metadata['runId'] = 'incomplete-control'
        metadata['planRevision'] = digest(plans['fixed'])
        metadata['context'] = {**context, 'windowEndMs': 30000}
        receipt = importer.build_receipt(metadata, Path(f'{prefix}.statistics.xml').read_bytes())
        write_json(f'{prefix}.receipt.json', receipt)
        if receipt['quality']['coverage'] != 'partial' or receipt['metrics']:
            raise ValueError('early-ended real SUMO run was not rejected')
        report['incompleteControl'] = receipt['quality']
        report['status'] = 'passed'
    except Exception as exc:
        report['error'] = str(exc)
        raise
    finally:
        write_json(out / 'summary.json', report)
        summary = ['# SUMO corridor integration benchmark', '',
                   f"Status: {report['status']}. Real simulator; synthetic roads and demand.", '',
                   '| Seed | Vehicles | Fixed time loss (s/veh) | Actuated (s/veh) | Change |',
                   '|---|---|---|---|---|']
        for pair in report['pairs']:
            metric = pair['comparison']['metrics']['meanVehicleTimeLossSeconds']
            summary.append(f"| {pair['seed']} | {pair['vehicleCount']} | {metric['baseline']} | "
                           f"{metric['candidate']} | {metric['percentChange']:.2f}% |")
        summary.extend(['', 'No field, city, pedestrian-safety or optimal-controller claim.',
                        'Negative change is lower modeled time loss, not proof of practical benefit.'])
        if 'error' in report:
            summary.extend(['', 'Failure: ' + report['error']])
        text = '\n'.join(summary) + '\n'
        (out / 'summary.md').write_text(text, encoding='utf-8')
        print(text)
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as file:
                file.write(text)


if __name__ == '__main__':
    main()
