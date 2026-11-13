#!/usr/bin/env python3
"""Score the SUMO corridor against published counts, one sourced change per step.

Metric: share of count-hours with GEH < 5 for three seeds. Step S0 is the
stack's own network, demand rates and fixed-time plan. Every later step changes
one input and names its source. Output is hypothetical simulation, not a field
result, and never a claim of real-world improvement.

The public summary holds shares and GEH bands only. Per count-hour values would
reveal the study's counts, so they go to --detail, outside the repository.
"""

import argparse
import importlib.util
import json
from pathlib import Path
import random
import shutil
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
FIXTURE = HERE / 'observed' / 'sr90-imperial-yorba-linda-20220315.json'
BIN_SECONDS = 900
BINS = 9                      # one warm-up interval, then two counted hours
END_SECONDS = BIN_SECONDS * BINS
HEADINGS = 'ESWN'             # clockwise; E is "towards SR-91"
TURN = {'l': -1, 't': 0, 'r': 1}


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


stack = load('corridor', 'run-sumo-corridor.py')
counts = load('observed_counts', 'observed-counts.py')


def in_edge(i, heading):
    return {'E': f'm{i - 1}e', 'W': f'm{i}w', 'S': f'N{i}in', 'N': f'S{i}in'}[heading]


def out_edge(i, heading):
    return {'E': f'm{i}e', 'W': f'm{i - 1}w', 'S': f'S{i}out', 'N': f'N{i}out'}[heading]


def arrival(edge):
    """Junction index and heading where an edge ends; None for an exit leg."""
    if edge.endswith('out'):
        return None
    i = int(edge[1])
    return {'e': (i + 1, 'E'), 'w': (i, 'W')}[edge[2]] if edge[0] == 'm' else \
        (i, 'S' if edge[0] == 'N' else 'N')


def turned(heading, move):
    return HEADINGS[(HEADINGS.index(heading) + TURN[move]) % 4]


def settings_for(fixture, step):
    settings, changes = dict(fixture['defaults']), None
    for entry in fixture['steps']:
        settings.update(entry['set'])
        if entry['id'] == step:
            changes = entry['change']
            break
    if changes is None:
        raise ValueError(f'unknown step {step}')
    return settings, changes


def build_sourced_network(out, fixture, derived):
    """Sourced spacing and stop-line lane groups; ids match the stack's corridor."""
    places, parameters = fixture['intersections'], fixture['parameters']
    stub = parameters['crossStubMetres']['value']
    speed = str(parameters['speedMetresPerSecond']['value'])

    def moves(i, heading):
        direction = counts.real_direction(places[i], heading)
        return counts.lane_moves(derived['lanes'][places[i]['sheet']][direction]) or ['ltr']

    lanes = {}
    for i in range(4):
        lanes[f'm{i}e'], lanes[f'm{i}w'] = moves(i + 1, 'E'), moves(i, 'W')
    for i in (1, 2, 3):
        lanes[f'N{i}in'], lanes[f'S{i}in'] = moves(i, 'S'), moves(i, 'N')
        for side in 'NS':   # exit leg: through-capable lanes of the same leg's entry
            lanes[f'{side}{i}out'] = [m for m in lanes[f'{side}{i}in'] if 't' in m] or ['t']
    nodes, edges, connections = ET.Element('nodes'), ET.Element('edges'), ET.Element('connections')
    x = 0
    for i, gap in enumerate([0] + parameters['spacingMetres']['value']):
        x += gap
        ET.SubElement(nodes, 'node', id=f'J{i}', x=str(x), y='0',
                      type='traffic_light' if i in (1, 2, 3) else 'priority')
        if i in (1, 2, 3):
            for side, y in (('N', stub), ('S', -stub)):
                ET.SubElement(nodes, 'node', id=f'{side}{i}', x=str(x), y=str(y), type='priority')
    for edge in sorted(lanes):
        i = int(edge[1])
        ends = ((f'J{i}', f'J{i + 1}') if edge[2] == 'e' else (f'J{i + 1}', f'J{i}')) \
            if edge[0] == 'm' else \
            ((f'{edge[0]}{i}', f'J{i}') if edge.endswith('in') else (f'J{i}', f'{edge[0]}{i}'))
        ET.SubElement(edges, 'edge', {'id': edge, 'from': ends[0], 'to': ends[1],
                      'numLanes': str(len(lanes[edge])), 'speed': speed,
                      'priority': '3' if edge[0] == 'm' else '1'})
    for i in (1, 2, 3):
        for heading in HEADINGS:
            source = in_edge(i, heading)
            for move in 'ltr':
                target = out_edge(i, turned(heading, move))
                width = len(lanes[target])
                serving = [k for k, served in enumerate(lanes[source]) if move in served] or \
                    [len(lanes[source]) - 1 if move == 'l' else 0]
                for j, lane in enumerate(serving):
                    to = max(0, width - len(serving) + j) if move == 'l' else min(j, width - 1)
                    ET.SubElement(connections, 'connection', {
                        'from': source, 'to': target, 'fromLane': str(lane), 'toLane': str(to)})
    for name, root in (('nodes', nodes), ('edges', edges), ('connections', connections)):
        stack.write_xml(out / f'{name}.xml', root)


def departures_from(derived, place, heading, window):
    """15-minute volumes leaving a counted intersection in one model heading."""
    index = HEADINGS.index(heading)
    thru = counts.movements(derived, place, heading, window)
    left = counts.movements(derived, place, HEADINGS[(index + 1) % 4], window)
    right = counts.movements(derived, place, HEADINGS[(index - 1) % 4], window)
    return [t[1] + l[0] + r[2] for t, l, r in zip(thru, left, right)]


def demand_inputs(fixture, derived, settings, window):
    """Entry volumes per 15 minutes (warm-up first) and the turning-share rule."""
    places, parameters = fixture['intersections'], fixture['parameters']
    rates = parameters['stackRatesPerHour']['value']

    def steady(per_hour):
        return [per_hour / 4] * BINS, False

    def counted(volumes):
        return [volumes[0]] + volumes, True

    entries = {}
    if settings['mainline'] == 'stack':
        entries['m0e'], entries['m3w'] = steady(rates['m0e']), steady(rates['m3w'])
    for i in (1, 2, 3):
        if settings['cross'] == 'stack':
            entries[f'N{i}in'] = entries[f'S{i}in'] = steady(rates['cross'])

    def shares(i, heading, interval):
        return (0, 1, 0)

    return entries, shares


def sample_route(rng, origin, shares, interval):
    """Walk from an entry edge, drawing one movement at each signal."""
    route = [origin]
    while (at := arrival(route[-1])) and at[0] in (1, 2, 3):
        left, thru, right = shares(at[0], at[1], interval)
        draw = rng.random() * (left + thru + right)
        move = 't' if left + thru + right == 0 else \
            'l' if draw < left else 't' if draw < left + thru else 'r'
        route.append(out_edge(at[0], turned(at[1], move)))
    return route


def write_demand(path, entries, shares, seed):
    """Seeded departures: Poisson for a rate, exactly N for a counted interval."""
    rng = random.Random(seed)
    departures = []
    for origin in sorted(entries):
        volumes, exact = entries[origin]
        for interval, volume in enumerate(volumes):
            start = interval * BIN_SECONDS
            if volume <= 0:
                continue
            if exact:
                times = [start + rng.random() * BIN_SECONDS for _ in range(round(volume))]
            else:
                times, time = [], start + rng.expovariate(volume / BIN_SECONDS)
                while time < start + BIN_SECONDS:
                    times.append(time)
                    time += rng.expovariate(volume / BIN_SECONDS)
            departures += [(round(time, 2), origin, interval) for time in times]
    departures.sort()
    root = ET.Element('routes')
    ET.SubElement(root, 'vType', id='car', vClass='passenger', accel='2.6', decel='4.5',
                  sigma='0.5', length='5', minGap='2.5', maxSpeed='13.89', speedFactor='1.0')
    for n, (time, origin, interval) in enumerate(departures):
        vehicle = ET.SubElement(root, 'vehicle', id=f'q4b-{seed}-{n}', type='car',
                                depart=f'{time:.2f}', departLane='best', departSpeed='max')
        ET.SubElement(vehicle, 'route', edges=' '.join(sample_route(rng, origin, shares, interval)))
    stack.write_xml(path, root)
    return len(departures)


def hourly_counts(edgedata, window, scored_edges):
    """Vehicles that left each scored edge per counted hour; a missing interval stays absent."""
    seen = {}
    for interval in ET.parse(edgedata).getroot().findall('interval'):
        index = int(float(interval.get('begin'))) // BIN_SECONDS
        for edge in interval.findall('edge'):
            seen[edge.get('id'), index] = int(edge.get('left', 0)) + int(edge.get('arrived', 0))
    simulated = {}
    for edge in scored_edges:
        for half in range(2):
            intervals = range(1 + 4 * half, 5 + 4 * half)
            if all((edge, index) in seen for index in intervals):
                simulated[f"{edge}@{window['firstHour'] + half:02d}"] = \
                    sum(seen[edge, index] for index in intervals)
    return simulated


def band(row):
    return 'absent' if row['geh'] is None else \
        'under5' if row['geh'] < 5 else 'from5to10' if row['geh'] < 10 else 'atLeast10'


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path, help='holds the fetched study')
    parser.add_argument('--detail', type=Path, help='private per count-hour table (keep out of git)')
    args = parser.parse_args(argv)
    fixture = json.loads(FIXTURE.read_text(encoding='utf-8'))
    settings, change = settings_for(fixture, args.step)
    derived = counts.load_observed(fixture, args.cache)
    scored = counts.scored_count_hours(fixture, derived)
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    sumo, netconvert = stack.check_binary('sumo', out), stack.check_binary('netconvert', out)
    stack_routes = stack.build_inputs(out)
    if settings['network'] == 'sourced':
        build_sourced_network(out, fixture, derived)
    network = out / 'corridor.net.xml'
    stack.run_command([netconvert, '--node-files', out / 'nodes.xml', '--edge-files',
                       out / 'edges.xml', '--connection-files', out / 'connections.xml',
                       '--no-turnarounds', 'true', '--tls.cycle.time', '60',
                       '--tls.yellow.time', '3', '--tls.allred.time', '1',
                       '--output-file', network], out / 'netconvert.log')
    stack.pin_network(network)
    plan = out / 'fixed.add.xml'
    stack.write_plan(network, plan, 'fixed')
    request = out / 'counts.add.xml'
    report = {'schemaVersion': 1, 'determination': 'hypothetical-simulation',
              'fixture': fixture['id'], 'step': args.step, 'change': change, 'settings': settings,
              'sumoVersion': stack.EXPECTED_VERSION, 'runnerRevision': stack.digest(__file__),
              'fixtureRevision': stack.digest(FIXTURE), 'networkRevision': stack.digest(network),
              'countSource': fixture['source']['sha256'], 'observedValuesStored': False,
              'countHours': len(scored), 'seeds': []}
    detail = []
    for seed in fixture['scoring']['seeds']:
        simulated, vehicles = {}, 0
        for window in fixture['source']['windows']:
            prefix = out / f"{window['id']}-{seed}"
            demand = Path(f'{prefix}.rou.xml')
            if settings['mainline'] == 'stack' and settings['cross'] == 'stack' \
                    and settings['turns'] == 'straight':
                stack.DEMAND_SECONDS = END_SECONDS      # the stack's own generator, sustained
                vehicles += stack.write_demand(demand, stack_routes, seed)
            else:
                vehicles += write_demand(demand, *demand_inputs(fixture, derived, settings,
                                                                window['id']), seed)
            edgedata = Path(f'{prefix}.edgedata.xml')
            root = ET.Element('additional')
            ET.SubElement(root, 'edgeData', id='counts', file=str(edgedata),
                          period=str(BIN_SECONDS))
            stack.write_xml(request, root)
            statistics = Path(f'{prefix}.statistics.xml')
            stack.run_command([sumo, '--net-file', network, '--route-files', demand,
                               '--additional-files', f'{plan},{request}', '--begin', '0',
                               '--end', str(END_SECONDS), '--seed', str(seed),
                               '--time-to-teleport', '-1', '--no-step-log', 'true',
                               '--duration-log.statistics', 'true',
                               '--statistic-output', statistics], f'{prefix}.log')
            safety = ET.parse(statistics).getroot().find('safety')
            if safety is None or safety.get('collisions') != '0' or safety.get('emergencyStops') != '0':
                raise ValueError('simulation safety fault or missing safety evidence; score withheld')
            simulated.update(hourly_counts(edgedata, window, fixture['scoredEdges']))
        result = counts.score(scored, simulated)
        bands = {name: sum(band(row) == name for row in result['rows'])
                 for name in ('under5', 'from5to10', 'atLeast10', 'absent')}
        report['seeds'].append({'seed': seed, 'vehiclesAuthored': vehicles,
                                'passed': result['passed'], 'share': round(result['share'], 4),
                                'gehBands': bands})
        detail.append({'seed': seed, 'rows': result['rows']})
    shares = [entry['share'] for entry in report['seeds']]
    report['meanShare'] = round(sum(shares) / len(shares), 4)
    report['stopReached'] = min(shares) >= fixture['scoring']['stopShare']
    stack.write_json(out / 'summary.json', report)
    if args.detail:
        stack.write_json(args.detail, detail)
    line = ' / '.join(f"{entry['passed']}/{report['countHours']}" for entry in report['seeds'])
    text = (f"{args.step}: count-hours with GEH < 5, seeds {fixture['scoring']['seeds']}: {line} "
            f"(mean share {report['meanShare']:.1%}). Hypothetical simulation; "
            'no real-world claim.\n')
    (out / 'summary.md').write_text(text, encoding='utf-8')
    print(text, end='')
    shutil.copy(FIXTURE, out / 'fixture.json')


if __name__ == '__main__':
    main()
