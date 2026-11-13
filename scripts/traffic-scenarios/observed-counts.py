#!/usr/bin/env python3
"""Published turning counts as a read-only yardstick for a simulated corridor.

The cited study is third-party work whose redistribution is not cleared, so no
value from it is stored here. The PDF is fetched by URL, checked against a
pinned hash, parsed, and the parsed result is checked against a second pinned
hash. A changed source or an edited count stops the run.
"""

import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import urllib.request

COMPASS = ('Eastbound', 'Southbound', 'Westbound', 'Northbound')  # clockwise
HEADINGS = 'ESWN'
BINS_PER_HOUR = 4
GEH_LIMIT = 5.0
SHEET_GROUPS = ('Groups Printed- Passenger Vehicles - Large 2 Axle Vehicles'
                ' - 3 Axle Vehicles - 4+ Axle Trucks')


def sha256(data):
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def canonical_hash(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())


def geh(modelled, observed):
    """GEH statistic for two hourly volumes (veh/h)."""
    if modelled < 0 or observed < 0:
        raise ValueError('volumes cannot be negative')
    total = modelled + observed
    return 0.0 if total == 0 else math.sqrt(2 * (modelled - observed) ** 2 / total)


def fetch_text(source, cache):
    """Download the cited PDF once, verify its pinned hash, extract its text."""
    cache = Path(cache)
    cache.mkdir(parents=True, exist_ok=True)
    pdf = cache / 'source.pdf'
    if not pdf.exists():
        request = urllib.request.Request(source['url'], headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=300) as response:
            pdf.write_bytes(response.read())
    if sha256(pdf.read_bytes()) != source['sha256']:
        raise ValueError('cited PDF does not match its pinned hash; refusing to parse')
    text = cache / 'source.txt'
    subprocess.run(['pdftotext', '-layout', str(pdf), str(text)], check=True, timeout=600)
    return text.read_text(encoding='utf-8', errors='replace')


def parse_sheet(text, name, start):
    """Read the all-vehicle page of one 15-minute turning-count sheet.

    Returns {direction: [[left, thru, right, rtor], ...]} and proves the
    printed approach and intersection totals from the parsed movements.
    """
    match = re.search(r'File Name\s*:\s*' + re.escape(name) + r'[ \t]*\n(.*?)Grand Total',
                      text, flags=re.S)
    if not match or SHEET_GROUPS not in match.group(1) or 'Page No : 1' not in match.group(1):
        raise ValueError(f'count sheet {name} not found')
    block = match.group(1)
    order = next((found for line in block.splitlines()
                  if len(found := re.findall('|'.join(COMPASS), line)) == 4), None)
    if not order or set(order) != set(COMPASS):
        raise ValueError(f'count sheet {name} lacks four approach headings')
    rows = re.findall(r'^\s*(\d\d):(\d\d) [AP]M((?:\s+\d+){23})\s*$', block, flags=re.M)
    hour, minute = (int(part) for part in start.split(':'))
    expected = [((hour * 60 + minute + 15 * i) % 720) for i in range(2 * BINS_PER_HOUR)]
    if [(int(h) % 12) * 60 + int(m) for h, m, _ in rows] != expected:
        raise ValueError(f'count sheet {name} is not eight consecutive 15-minute rows')
    counts = {direction: [] for direction in order}
    for _, _, cells in rows:
        values = [int(cell) for cell in cells.split()]
        approaches = [values[i:i + 5] for i in range(0, 20, 5)]
        excluded, included, total = values[20:]
        if (any(sum(a[:3]) != a[4] for a in approaches)
                or sum(a[3] for a in approaches) != excluded
                or sum(a[4] for a in approaches) != included
                or included + excluded != total):
            raise ValueError(f'count sheet {name} totals do not match its movements')
        for direction, approach in zip(order, approaches):
            counts[direction].append(approach[:4])
    return counts


def parse_lanes(text, number):
    """Stop-line lane groups from the study's capacity worksheet.

    Returns {direction: [left, left+thru, thru, thru+right, right]} as printed;
    "1!" in the thru slot is one lane shared by all three movements.
    """
    match = re.search(rf'Intersection #{number} [^\n]*\n.*?Approach:([^\n]*)\n.*?'
                      r'Lanes:((?:\s+\d+!?){20})\s*\n', text, flags=re.S)
    if not match:
        raise ValueError(f'lane worksheet {number} not found')
    order = [word + 'bound' for word in re.findall(r'(North|South|East|West) Bound',
                                                    match.group(1))]
    if set(order) != set(COMPASS):
        raise ValueError(f'lane worksheet {number} lacks four approaches')
    tokens = match.group(2).split()
    return {direction: tokens[i * 5:i * 5 + 5] for i, direction in enumerate(order)}


def lane_moves(tokens):
    """Movements served by each stop-line lane, from the right kerb to the left."""
    left, left_thru, thru, thru_right, right = tokens
    groups = [(right, 'r'), (thru_right, 'tr'), (thru, 'ltr' if thru.endswith('!') else 't'),
              (left_thru, 'lt'), (left, 'l')]
    return [moves for count, moves in groups for _ in range(int(count.rstrip('!')))]


def load_observed(fixture, cache):
    """Parse every cited sheet and worksheet, then require the pinned hash."""
    source = fixture['source']
    text = fetch_text(source, cache)
    derived = {'counts': {}, 'lanes': {}}
    for place in fixture['intersections']:
        derived['counts'][place['sheet']] = {
            window['id']: parse_sheet(text, f"{place['sheet']} {window['id']}", window['start'])
            for window in source['windows']}
        derived['lanes'][place['sheet']] = parse_lanes(text, place['worksheet'])
    if canonical_hash(derived) != source['derivedSha256']:
        raise ValueError('parsed counts differ from the pinned parse; observed counts are never edited')
    return derived


def real_direction(place, heading):
    """Model heading E means "towards SR-91"; turn it back to the sheet's compass."""
    return COMPASS[(HEADINGS.index(heading) + COMPASS.index(place['towardsSr91'])) % 4]


def movements(derived, place, heading, window):
    """Eight [left, thru, right incl. right-on-red] rows for one model approach."""
    rows = derived['counts'][place['sheet']][window][real_direction(place, heading)]
    return [[left, thru, right + rtor] for left, thru, right, rtor in rows]


def scored_count_hours(fixture, derived):
    """The fixed list of count-hours every step is judged on."""
    places = fixture['intersections']
    scored = []
    for edge in fixture['scoredEdges']:
        index, heading = int(edge[1]), edge[2].upper()
        place = places[index + 1] if heading == 'E' else places[index]
        for window in fixture['source']['windows']:
            rows = movements(derived, place, heading, window['id'])
            for half in range(2):
                hour = window['firstHour'] + half
                observed = sum(sum(row) for row in rows[half * BINS_PER_HOUR:(half + 1) * BINS_PER_HOUR])
                scored.append({'id': f'{edge}@{hour:02d}', 'edge': edge, 'window': window['id'],
                               'half': half, 'observed': observed})
    return scored


def score(scored, simulated):
    """Share of count-hours with GEH < 5. A missing simulated value fails; it is not 0."""
    rows = []
    for item in scored:
        value = simulated.get(item['id'])
        statistic = None if value is None else geh(value, item['observed'])
        rows.append({**item, 'simulated': value, 'geh': statistic,
                     'pass': statistic is not None and statistic < GEH_LIMIT})
    passed = sum(row['pass'] for row in rows)
    return {'countHours': len(rows), 'passed': passed,
            'absent': sum(row['simulated'] is None for row in rows),
            'share': passed / len(rows), 'rows': rows}
