import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateHumanitarianDataPolicy } from './humanitarianDataPolicy.js';

test('public hazard geometry is renderable, cacheable, shareable and agent-visible', () => {
  const result = evaluateHumanitarianDataPolicy({
    sensitivity: 'public',
  });

  assert.equal(result.authorized, true);
  assert.deepEqual(result.permissions, {
    render: true,
    cache: true,
    export: true,
    share: true,
    agentVisible: true,
  });
  assert.deepEqual(result.reasons, []);
});

test('restricted operational routes fail closed without an explicit role match', () => {
  const denied = evaluateHumanitarianDataPolicy({
    sensitivity: 'restricted',
    allowedRoles: ['logistics'],
    permissions: {
      render: true,
      cache: true,
      export: true,
      share: true,
      agentVisible: true,
    },
  });

  assert.equal(denied.authorized, false);
  assert.deepEqual(denied.permissions, {
    render: false,
    cache: false,
    export: false,
    share: false,
    agentVisible: false,
  });
  assert.ok(denied.reasons.includes('role-not-authorized'));
});

test('restricted access can be granted per action without granting export by accident', () => {
  const result = evaluateHumanitarianDataPolicy(
    {
      sensitivity: 'restricted',
      allowedRoles: ['logistics'],
      permissions: {
        render: true,
        cache: true,
        agentVisible: true,
      },
    },
    { roles: ['logistics'] },
  );

  assert.equal(result.authorized, true);
  assert.equal(result.permissions.render, true);
  assert.equal(result.permissions.cache, true);
  assert.equal(result.permissions.export, false);
  assert.equal(result.permissions.share, false);
  assert.equal(result.permissions.agentVisible, true);
});

test('sensitive shelter policy carries explicit coarsening/redaction and no persistence', () => {
  const result = evaluateHumanitarianDataPolicy(
    {
      sensitivity: 'sensitive',
      allowedRoles: ['field-coordinator'],
      noPersistentCache: true,
      coarsenMeters: 5000,
      redactFields: ['contactName', 'preciseCapacity'],
      permissions: { render: true },
    },
    { roles: ['field-coordinator'] },
  );

  assert.equal(result.permissions.render, true);
  assert.equal(result.permissions.cache, false);
  assert.equal(result.permissions.export, false);
  assert.equal(result.permissions.share, false);
  assert.equal(result.permissions.agentVisible, false);
  assert.deepEqual(result.transform, {
    coarsenMeters: 5000,
    redactFields: ['contactName', 'preciseCapacity'],
  });
  assert.ok(result.reasons.includes('persistent-cache-forbidden'));
});

test('anonymous aggregate CCTV traffic is not blocked merely because it came from a camera', () => {
  const result = evaluateHumanitarianDataPolicy({
    sensitivity: 'public',
    capabilities: ['anonymous-aggregate-traffic'],
  });

  assert.equal(result.permissions.render, true);
  assert.equal(result.permissions.export, true);
  assert.equal(result.permissions.agentVisible, true);
});

test('identity-bearing humanitarian capability is prohibited even under permissive flags', () => {
  const result = evaluateHumanitarianDataPolicy({
    sensitivity: 'public',
    capabilities: ['person-identification'],
    permissions: {
      render: true,
      cache: true,
      export: true,
      share: true,
      agentVisible: true,
    },
  });

  assert.deepEqual(result.permissions, {
    render: false,
    cache: false,
    export: false,
    share: false,
    agentVisible: false,
  });
  assert.ok(
    result.reasons.includes('prohibited-capability:person-identification'),
  );
});

test('prohibited-export is a hard boundary even for an authorized role', () => {
  const result = evaluateHumanitarianDataPolicy(
    {
      sensitivity: 'prohibited-export',
      allowedRoles: ['analyst'],
      permissions: {
        render: true,
        cache: true,
        export: true,
        share: true,
        agentVisible: true,
      },
    },
    { roles: ['analyst'] },
  );

  assert.equal(result.permissions.render, true);
  assert.equal(result.permissions.cache, true);
  assert.equal(result.permissions.export, false);
  assert.equal(result.permissions.share, false);
  assert.equal(result.permissions.agentVisible, true);
  assert.ok(result.reasons.includes('prohibited-export'));
});

test('future publication boundary blocks export/share without hiding local evidence', () => {
  const result = evaluateHumanitarianDataPolicy(
    {
      sensitivity: 'public',
      publishAfter: '2026-10-04T00:00:00Z',
    },
    { now: Date.parse('2026-10-03T12:00:00Z') },
  );

  assert.equal(result.permissions.render, true);
  assert.equal(result.permissions.cache, true);
  assert.equal(result.permissions.export, false);
  assert.equal(result.permissions.share, false);
  assert.equal(result.permissions.agentVisible, true);
  assert.ok(result.reasons.includes('publication-delayed'));
});

test('unknown sensitivity fails closed', () => {
  const result = evaluateHumanitarianDataPolicy({
    sensitivity: 'classified-somehow',
  });

  assert.equal(result.sensitivity, 'unknown');
  assert.equal(result.authorized, false);
  assert.ok(
    Object.values(result.permissions).every((value) => value === false),
  );
  assert.deepEqual(result.reasons, ['sensitivity-unknown']);
});

test('agent visibility is never broader than human rendering', () => {
  const result = evaluateHumanitarianDataPolicy(
    {
      sensitivity: 'restricted',
      allowedRoles: ['ops'],
      permissions: {
        render: false,
        agentVisible: true,
      },
    },
    { roles: ['ops'] },
  );

  assert.equal(result.permissions.render, false);
  assert.equal(result.permissions.agentVisible, false);
});
