import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { WALK_ACCESS_FIXTURE } from '../data/walkAccessFixture.js';
import { suggestWalkAccessSites } from '../data/walkAccessSites.js';
import {
  presentCityWalkAccess,
  presentSiteSuggestion,
} from './cityWalkAccess.js';

const eligibility = Object.fromEntries(
  WALK_ACCESS_FIXTURE.sites.map((site) => [site.id, 'assumed-feasible']),
);
const metres = (value) => `${Math.round(value)} m`;

test('the suggested row shows the exact record: same sites, same metres as the comparison', () => {
  for (const siteCount of [1, 2])
    for (const objective of ['average', 'worst-served']) {
      const { suggestion, ranking } = suggestWalkAccessSites({
        network: WALK_ACCESS_FIXTURE,
        eligibility,
        siteCount,
        objective,
      });
      const { rows } = presentCityWalkAccess([], { objective, siteCount });
      const row = rows.at(-1);
      assert.equal(rows.length, 2);
      assert.equal(row.id, 'suggestion');
      assert.equal(row.suggested, `${objective}:${siteCount}`);
      assert.equal(
        row.site,
        suggestion.siteIds
          .map((id) => `Site ${id.at(-1).toUpperCase()}`)
          .join(' + '),
      );
      // The row is drawn by the comparison's own evaluation; the record agrees.
      assert.equal(row.mean, metres(suggestion.meanMeters));
      assert.equal(row.worst, metres(suggestion.worstMeters));
      assert.deepEqual(
        row.zones.map((zone) => zone.label),
        WALK_ACCESS_FIXTURE.zones.map(({ id }) =>
          String(suggestion.zones.find((zone) => zone.id === id).meters),
        ),
      );
      assert.match(
        row.method,
        new RegExp(`${ranking.length} possible choices`),
      );
    }
  // Without a request there is no suggestion row.
  assert.deepEqual(
    presentCityWalkAccess([]).rows.map((row) => row.id),
    ['baseline'],
  );
});

test('a study without a valid answer shows its reason and never a site', () => {
  const cut = {
    ...WALK_ACCESS_FIXTURE,
    edges: WALK_ACCESS_FIXTURE.edges.filter(
      (edge) => edge.from !== 'a0' && edge.to !== 'a0',
    ),
  };
  for (const record of [
    suggestWalkAccessSites({ network: cut, eligibility }),
    suggestWalkAccessSites({ network: WALK_ACCESS_FIXTURE }),
  ]) {
    const row = presentSiteSuggestion(record);
    assert.deepEqual(Object.keys(row), ['id', 'label', 'state', 'note']);
    assert.equal(row.state, 'unknown');
    assert.match(row.note, /^Unknown: no site is suggested/);
    assert.ok(row.note.includes(record.reason));
  }
});

test('the panel reaches the exact reference only through suggestWalkAccessSites', () => {
  const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
  assert.match(source('./cityWalkAccess.js'), /suggestWalkAccessSites\(\{/);
  for (const name of [
    './cityWalkAccess.js',
    './cityBuilder.js',
    './views/panels/CityWalkAccess.vue',
  ])
    assert.doesNotMatch(source(name), /communityFacilityAccess/);
});
