import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyntheticReliefDemoPacket } from './demoFixture.js';
import { reliefViewModel, renderReliefFieldView } from './reliefView.js';

function fakeDocument() {
  return {
    createElement(tagName) {
      return {
        tagName, className: '', children: [], textContent: '', attributes: {},
        appendChild(x) { this.children.push(x); return x; },
        setAttribute(key, value) { this.attributes[key] = value; },
      };
    },
  };
}
function fakeRoot() {
  const ownerDocument = fakeDocument();
  return { ownerDocument, children: [], replaceChildren(...items) { this.children = items; } };
}
const values = root => JSON.stringify(root, (key, value) => key === 'ownerDocument' ? undefined : value);

test('the exact synthetic replay reaches Field Lite with source and zero live authority', () => {
  const packet = createSyntheticReliefDemoPacket();
  assert.equal(packet.status, 'evaluated');
  const model = reliefViewModel(packet);
  assert.equal(model.studyId, 'idai-style-synthetic');
  assert.equal(model.stages[0].served, 4);
  assert.equal(model.stages[1].served, 2);
  assert.equal(model.delta, -2);
  assert.equal(model.stages[0].revision, 'access-r1');
  assert.equal(model.stages[1].revision, 'access-r2');
  assert.equal(model.stages[1].evidence.includes('synthetic:road-closure-r2'), true);
  assert.equal('authority' in model, false);
  assert.equal('safe' in model, false);
});

test('read-only renderer has before/after cards, source details and no HTML injection', () => {
  const root = fakeRoot();
  assert.equal(renderReliefFieldView(root, createSyntheticReliefDemoPacket()), true);
  const out = values(root);
  assert.match(out, /Before — superseded/);
  assert.match(out, /After — revised hypothesis/);
  assert.match(out, /TRAINING|synthetic only/);
  assert.match(out, /No operational route or delivery decisions are authorized/);
  assert.match(out, /synthetic:road-closure-r2/);
  assert.match(out, /2 known-only synthetic units/);
  assert.equal('winner' in root, false);
  const suspicious = structuredClone(createSyntheticReliefDemoPacket());
  suspicious.source.studyId = '<img src=x onerror=alert(1)>';
  const untrustedRoot = fakeRoot();
  assert.equal(renderReliefFieldView(untrustedRoot, suspicious), true);
  assert.match(values(untrustedRoot), /<img src=x onerror=alert\(1\)>/);
  assert.equal(values(untrustedRoot).includes('innerHTML'), false);
});

test('invalid shape, authority, stale revision or corrupted evidence fail closed', () => {
  const original = createSyntheticReliefDemoPacket();
  for (const change of [
    { authority: 'dispatch' },
    { determination: 'observed' },
    { historicalBaselineCurrent: true },
    { status: 'unknown' },
    { delta: { knownOnlyServedUnits: 99 } },
    { stages: [original.stages[0], { ...original.stages[1], accessRevision: original.stages[0].accessRevision }] },
    { fieldLite: { rows: [{ evidenceRefs: [] }, {}], notices: original.fieldLite.notices } },
  ]) {
    assert.equal(reliefViewModel({ ...original, ...change }), null);
    const root = fakeRoot();
    assert.equal(renderReliefFieldView(root, { ...original, ...change }), false);
    assert.equal(root.children[0].attributes.role, 'alert');
  }
  const root = fakeRoot();
  assert.throws(() => renderReliefFieldView({}, original), /document-backed/);
});

test('rendering does not mutate the upstream packet or import Cesium', () => {
  const packet = createSyntheticReliefDemoPacket();
  const baseline = JSON.stringify(packet);
  renderReliefFieldView(fakeRoot(), packet);
  assert.equal(JSON.stringify(packet), baseline);
  assert.equal(Object.isFrozen(packet), true);
});

test('evidence rows cannot be relabelled across before/after revisions', () => {
  const valid = createSyntheticReliefDemoPacket();
  const corruptions = [
    (p) => p.fieldLite.rows.reverse(),
    (p) => { p.fieldLite.rows[0].phase = 'revised'; },
    (p) => { p.fieldLite.rows[0].accessRevision = p.stages[1].accessRevision; },
    (p) => { p.fieldLite.rows[0].exactKnownOnlyServedUnits += 1; },
    (p) => { p.fieldLite.rows[1].nearestFirstKnownOnlyServedUnits += 1; },
    (p) => { p.fieldLite.rows[1].unknownRoutes += 1; },
  ];
  for (const corrupt of corruptions) {
    const packet = structuredClone(valid);
    corrupt(packet);
    assert.equal(reliefViewModel(packet), null);
    const root = fakeRoot();
    assert.equal(renderReliefFieldView(root, packet), false);
    assert.equal(root.children[0].attributes.role, 'alert');
  }
});

test('display status cannot overstate an uncertain synthetic stage', () => {
  const original = createSyntheticReliefDemoPacket();
  assert.equal(original.status, 'evaluated');

  const mismatched = structuredClone(original);
  mismatched.status = 'limited';
  assert.equal(reliefViewModel(mismatched), null);

  const stageDrift = structuredClone(original);
  stageDrift.stages[1].status = 'limited';
  stageDrift.stages[1].unknownRoutes = 1;
  stageDrift.fieldLite.rows[1].unknownRoutes = 1;
  assert.equal(reliefViewModel(stageDrift), null);

  const falseEvaluated = structuredClone(original);
  falseEvaluated.stages[1].unknownRoutes = 1;
  falseEvaluated.fieldLite.rows[1].unknownRoutes = 1;
  assert.equal(reliefViewModel(falseEvaluated), null);

  const limited = structuredClone(stageDrift);
  limited.status = 'limited';
  const model = reliefViewModel(limited);
  assert.equal(model?.status, 'limited');
  assert.equal(model?.stages[1].unknownRoutes, 1);
});
