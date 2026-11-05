export const HUMANITARIAN_SENSITIVITIES = Object.freeze([
  'public',
  'restricted',
  'sensitive',
  'prohibited-export',
]);

export const PROHIBITED_HUMANITARIAN_CAPABILITIES = Object.freeze([
  'face-recognition',
  'person-identification',
  'humanitarian-plate-ocr',
  'persistent-person-tracking',
  'persistent-vehicle-tracking',
  'refugee-migrant-tracking',
  'inferred-private-capacity',
  'military-targeting',
  'nonconsensual-community-intelligence',
]);

const ACTIONS = Object.freeze([
  'render',
  'cache',
  'export',
  'share',
  'agentVisible',
]);

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function roleAuthorized(sensitivity, allowedRoles, sessionRoles) {
  if (sensitivity === 'public') return true;
  if (!allowedRoles.length) return false;
  const active = new Set(sessionRoles);
  return allowedRoles.some((role) => active.has(role));
}

function baselinePermissions(sensitivity) {
  if (sensitivity === 'public') {
    return {
      render: true,
      cache: true,
      export: true,
      share: true,
      agentVisible: true,
    };
  }
  return {
    render: true,
    cache: false,
    export: false,
    share: false,
    agentVisible: false,
  };
}

function requestedPermission(policy, action, fallback) {
  const value = policy?.permissions?.[action];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Evaluate one humanitarian record/source policy without depending on UI state.
 *
 * Non-public records require an explicit role match. Their cache/export/share/
 * agent permissions are deny-by-default and must be granted explicitly.
 * Prohibited capabilities fail closed for every action. A prohibited-export
 * record can never be exported or shared even when an override asks for it.
 */
export function evaluateHumanitarianDataPolicy(
  policy = {},
  { roles = [], now = Date.now() } = {},
) {
  const sensitivity = HUMANITARIAN_SENSITIVITIES.includes(policy?.sensitivity)
    ? policy.sensitivity
    : null;
  const allowedRoles = stringList(policy?.allowedRoles);
  const sessionRoles = stringList(roles);
  const capabilities = stringList(policy?.capabilities);
  const redactedFields = stringList(policy?.redactFields);
  const prohibitedCapabilities = capabilities.filter((capability) =>
    PROHIBITED_HUMANITARIAN_CAPABILITIES.includes(capability),
  );
  const reasons = new Set();

  const transform = Object.freeze({
    coarsenMeters: finiteNonNegative(policy?.coarsenMeters) ?? 0,
    redactFields: Object.freeze(redactedFields),
  });

  const cacheTtlMs = finiteNonNegative(policy?.cacheTtlMs);
  const publishAfterMs = policy?.publishAfter
    ? Date.parse(String(policy.publishAfter))
    : Number.NaN;
  const publicationDelayed =
    Number.isFinite(publishAfterMs) && publishAfterMs > Number(now);

  if (!sensitivity) {
    reasons.add('sensitivity-unknown');
    return Object.freeze({
      sensitivity: 'unknown',
      authorized: false,
      permissions: Object.freeze(
        Object.fromEntries(ACTIONS.map((action) => [action, false])),
      ),
      transform,
      cacheTtlMs,
      reasons: Object.freeze([...reasons]),
    });
  }

  const authorized = roleAuthorized(sensitivity, allowedRoles, sessionRoles);
  if (!authorized) reasons.add('role-not-authorized');

  const base = baselinePermissions(sensitivity);
  const permissions = {};
  for (const action of ACTIONS) {
    permissions[action] =
      authorized && requestedPermission(policy, action, base[action]);
  }

  if (policy?.noPersistentCache === true) {
    permissions.cache = false;
    reasons.add('persistent-cache-forbidden');
  }

  if (sensitivity === 'prohibited-export') {
    permissions.export = false;
    permissions.share = false;
    reasons.add('prohibited-export');
  }

  if (publicationDelayed) {
    permissions.export = false;
    permissions.share = false;
    reasons.add('publication-delayed');
  }

  for (const capability of prohibitedCapabilities) {
    reasons.add('prohibited-capability:' + capability);
  }
  if (prohibitedCapabilities.length) {
    for (const action of ACTIONS) permissions[action] = false;
  }

  // An agent never receives more visibility than the authorized human session.
  if (!permissions.render) permissions.agentVisible = false;
  if (!permissions.agentVisible && authorized && sensitivity !== 'public') {
    reasons.add('agent-visibility-not-granted');
  }

  if (!permissions.export && authorized) reasons.add('export-not-granted');
  if (!permissions.share && authorized) reasons.add('share-not-granted');
  if (!permissions.cache && authorized && policy?.noPersistentCache !== true) {
    reasons.add('cache-not-granted');
  }

  return Object.freeze({
    sensitivity,
    authorized,
    permissions: Object.freeze(permissions),
    transform,
    cacheTtlMs,
    reasons: Object.freeze([...reasons]),
  });
}
