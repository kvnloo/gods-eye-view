import assert from 'node:assert/strict';
import test from 'node:test';
import { createHumanDecisionBrief } from './brief.js';
import { exportHumanDecisionBrief } from './share.js';

function pinnedPacket() {
  return {
    schemaVersion: 1,
    id: 'replay-01',
    revision: 'packet-r1',
    capturedAt: '2026-01-03T00:00:00Z',
    question: 'Which claims need human review?',
    authorRef: 'local-draft',
    sources: [
      {
        id: 'source-b',
        revision: 'feed-v3',
        url: 'https://sources.example/evidence/b',
        rights: 'restricted',
        license: 'unknown',
        attribution: 'Source B',
        observedAt: null,
        recordedAt: '2026-01-02T00:00:00Z',
      },
      {
        id: 'source-a',
        revision: 'feed-v1',
        url: 'https://sources.example/evidence/a',
        rights: 'reference-only',
        license: 'citation-only',
        attribution: 'Source A',
        observedAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-02T00:00:00Z',
      },
    ],
    claims: [
      {
        id: 'model',
        lane: 'modeled',
        status: 'reported',
        statement: 'Alternative crossing is hypothetical',
        uncertainty: 'No independent verification',
        observedAt: null,
        sourceIds: ['source-b'],
      },
      {
        id: 'stale',
        lane: 'observed',
        status: 'stale',
        statement: 'A segment was reported open in historical material',
        uncertainty: 'The source is stale',
        observedAt: '2026-01-01T00:00:00Z',
        sourceIds: ['source-a'],
      },
      {
        id: 'unknown',
        lane: 'observed',
        status: 'unknown',
        statement: 'Current segment condition not assessed',
        uncertainty: 'No corroborated source',
        observedAt: null,
        sourceIds: [],
      },
      {
        id: 'conflict',
        lane: 'observed',
        status: 'conflicted',
        statement: 'Two reports disagree about conditions',
        uncertainty: 'Conflict unresolved',
        observedAt: null,
        sourceIds: ['source-b', 'source-a'],
      },
    ],
    handoff: {
      label: 'External human review queue',
      url: 'https://review.example/queue/1',
    },
  };
}

test('pinned packet produces byte-identical source-linked JSON and Markdown', () => {
  const packet = pinnedPacket();
  const baseline = exportHumanDecisionBrief(packet);
  assert.deepEqual(exportHumanDecisionBrief(packet), baseline);
  packet.sources.reverse();
  packet.claims.reverse();
  packet.claims[0].sourceIds.reverse();
  assert.deepEqual(exportHumanDecisionBrief(packet), baseline);
  assert.equal(JSON.parse(baseline.json).packet.revision, 'packet-r1');
  assert.equal(baseline.receipt.packet.authorRef, 'local-draft');
  assert.match(baseline.markdown, /https:\/\/sources\.example\/evidence\/a/);
  assert.match(baseline.markdown, /https:\/\/review\.example\/queue\/1/);
  assert.doesNotMatch(baseline.markdown, /!\[|data:image|<img/i);
});

test('time, rights, stale, unknown and conflict status survive round-trip', () => {
  const packet = pinnedPacket();
  const { json, receipt, markdown } = exportHumanDecisionBrief(packet);
  assert.deepEqual(JSON.parse(json), receipt);
  assert.equal(receipt.schema, 'gev-human-readonly-brief/v1');
  assert.deepEqual(
    receipt.sources.map((row) => [row.id, row.rights, row.observedAt]),
    [
      ['source-a', 'reference-only', '2026-01-01T00:00:00.000Z'],
      ['source-b', 'restricted', null],
    ],
  );
  assert.deepEqual(receipt.findings.observed.map((row) => row.id), [
    'conflict',
    'stale',
    'unknown',
  ]);
  assert.deepEqual(receipt.findings.modeled.map((row) => row.id), ['model']);
  assert.deepEqual(receipt.findings.stale.map((row) => row.id), ['stale']);
  assert.deepEqual(receipt.findings.unknowns.map((row) => row.id), ['unknown']);
  assert.deepEqual(receipt.findings.conflicts[0].sourceIds, [
    'source-a',
    'source-b',
  ]);
  assert.equal(receipt.externalDecision.status, 'not-recorded-by-gev');
  assert.match(markdown, /## Stale evidence/);
  assert.match(markdown, /## Unknowns \/ absences/);
  assert.match(markdown, /## Modeled \/ hypothetical/);
  assert.match(markdown, /## External decision \/ commitment/);
  assert.doesNotMatch(markdown, /status: approved/i);
});

test('unknown source is not fabricated and no missing source becomes verified', () => {
  const packet = pinnedPacket();
  packet.claims[1].sourceIds = ['missing-feed'];
  assert.throws(() => createHumanDecisionBrief(packet), /linked evidence/);
  packet.claims[1].sourceIds = [];
  assert.throws(() => createHumanDecisionBrief(packet), /linked evidence/);
  const absent = pinnedPacket();
  absent.claims[2].status = 'absent';
  absent.claims[2].sourceIds = ['source-a'];
  const receipt = createHumanDecisionBrief(absent);
  assert.equal(receipt.findings.unknowns[0].status, 'absent');
});

test('rejects media, arbitrary action claims and claimed approval on import', () => {
  const raw = pinnedPacket();
  raw.sources[0].rawMedia = 'AAAA';
  assert.throws(() => exportHumanDecisionBrief(raw), /unsupported field/);
  const inject = pinnedPacket();
  inject.claims[0].action = { dispatch: true };
  assert.throws(() => exportHumanDecisionBrief(inject), /unsupported field/);
  const approval = pinnedPacket();
  approval.claims[0].statement = 'Agency approved dispatch';
  assert.throws(() => exportHumanDecisionBrief(approval), /approval assertions/);
  const malicious = pinnedPacket();
  malicious.claims[0].statement = 'data:image/png;base64,AAAA';
  assert.throws(() => exportHumanDecisionBrief(malicious), /reference text/);
  const forged = pinnedPacket();
  forged.approval = { status: 'granted' };
  assert.throws(() => exportHumanDecisionBrief(forged), /unsupported field/);
  const disguised = pinnedPacket();
  disguised.question = 'Agency approved dispatch';
  assert.throws(() => exportHumanDecisionBrief(disguised), /approval assertions/);
  const attribution = pinnedPacket();
  attribution.sources[0].attribution = 'Agency officially approved dispatch';
  assert.throws(() => exportHumanDecisionBrief(attribution), /approval assertions/);
});

test('fails closed on invalid rights, timestamps, source revisions and URLs', () => {
  const altered = [
    (p) => {
      p.sources[0].rights = 'permitted';
    },
    (p) => {
      delete p.sources[0].license;
    },
    (p) => {
      p.sources[0].recordedAt = '2026-02-30T00:00:00Z';
    },
    (p) => {
      p.sources[0].revision = '';
    },
    (p) => {
      p.sources[0].url = 'data:text/plain,unsafe';
    },
    (p) => {
      p.sources[0].url = 'https://u:p@sources.example/evidence';
    },
    (p) => {
      p.handoff.url = 'javascript:alert(1)';
    },
    (p) => {
      p.handoff.label = 'Officially approved';
    },
  ];
  for (const change of altered) {
    const packet = pinnedPacket();
    change(packet);
    assert.throws(() => exportHumanDecisionBrief(packet));
  }
});

test('Markdown escapes source-owned text rather than executing markup', () => {
  const packet = pinnedPacket();
  packet.sources[0].attribution = 'Records <script> & Archive';
  packet.claims[0].statement = 'Comparison [hypothesis](unsafe)';
  const result = exportHumanDecisionBrief(packet);
  assert.match(result.markdown, /&lt;script&gt;/);
  assert.match(result.markdown, /&amp;/);
  assert.doesNotMatch(result.markdown, /<script>/);
  assert.doesNotMatch(result.markdown, /\[hypothesis\]\(unsafe\)/);
  assert.equal(result.receipt.sources[1].attribution, 'Records <script> & Archive');
});
