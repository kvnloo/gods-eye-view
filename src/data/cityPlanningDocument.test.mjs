import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCityDocument,
  addCityAlternative,
  reviseCityAlternative,
  attachCityConcept,
  parseCityDocument,
  serializeCityDocument,
  replayCityDocument,
  cityAlternatives,
  cityZoning,
  setCityZoning,
  CITY_LAND_USES,
} from './cityPlanningDocument.js';
import { snapPlot } from './cityPlot.js';
import {
  createPlanningAlternativeOperation,
  listPlanningAlternatives,
} from './communityPlanning.js';
import {
  applyCollaborationOperations,
  createCollaborationState,
} from './collaborationAuthority.js';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const JPEG = 'data:image/jpeg;base64,/9j/2Q==';
const LABEL = 'AI concept, not a plan or an approval';
const copy = (value) => structuredClone(value);
function reference() {
  return {
    camera: {
      lat: 40.05,
      lon: -88.15,
      alt: 500,
      heading: 0,
      pitch: -45,
      roll: 0,
    },
    bounds: [-88.2, 40, -88.1, 40.1],
    sources: [
      {
        id: 'parcel',
        revision: '2026-09',
        url: 'https://example.org/parcel',
        attribution: 'Public parcel fixture',
        license: 'CC0',
      },
    ],
    capturedAt: '2026-11-10T12:00:00.000Z',
    image: PNG,
  };
}
function parameters(kind = 'park') {
  return { kind, trees: 12, widthMeters: 2.5, shadePercent: 40 };
}
function alternative(id = 'green') {
  return {
    id,
    title: 'Green option',
    description: 'An unverified design hypothesis.',
    parameters: parameters(),
  };
}
function document() {
  return createCityDocument({
    id: 'city-demo',
    title: 'City demo',
    reference: reference(),
  });
}
function populated() {
  return addCityAlternative(document(), alternative());
}
function concept() {
  return {
    prompt: 'Imagine the park',
    provider: 'fixture',
    generatedAt: '2026-11-10T12:01:00.000Z',
    sourceView: reference(),
    image: JPEG,
  };
}
function rejectImport(mutate, base = populated()) {
  const value = copy(base);
  mutate(value);
  assert.throws(() => parseCityDocument(JSON.stringify(value)));
}

test('document roundtrip is detached, immutable, and uses a reference-only kernel project', () => {
  const input = { id: 'city-demo', title: 'City demo', reference: reference() };
  const doc = createCityDocument(input);
  input.reference.sources[0].license = 'changed';
  assert.equal(doc.reference.sources[0].license, 'CC0');
  assert.deepEqual(Object.keys(doc).sort(), [
    'alternatives',
    'kind',
    'project',
    'reference',
    'schemaVersion',
  ]);
  assert.equal(doc.kind, 'city-builder');
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.project.baseline.state, 'reference-only');
  assert.equal(doc.project.approval, 'not-requested');
  assert.equal(doc.project.implementation, 'not-started');
  const parsed = parseCityDocument(serializeCityDocument(doc));
  assert.deepEqual(parsed, doc);
  assert.notEqual(parsed, doc);
  assert.ok(Object.isFrozen(parsed.reference.camera));
  assert.ok(Object.isFrozen(parsed.reference.sources[0]));
  assert.throws(() => {
    parsed.reference.bounds[0] = 0;
  }, TypeError);
});

test('versions retain actual constructor-produced proposals and replay through the authority kernel', () => {
  const first = populated();
  const second = reviseCityAlternative(first, 'green', 1, {
    title: 'More shade',
    description: 'Add more trees.',
    parameters: { ...parameters(), trees: 20 },
  });
  const third = addCityAlternative(second, alternative('plaza'));
  assert.equal(first.alternatives[0].versions.length, 1);
  const versions = third.alternatives[0].versions;
  assert.deepEqual(
    versions.map(({ revision, parentRevision }) => [revision, parentRevision]),
    [
      [1, null],
      [2, 1],
    ],
  );
  const ops = third.alternatives.flatMap((a) =>
    a.versions.map((v) => v.operation),
  );
  for (const a of third.alternatives)
    for (const v of a.versions) {
      const op = v.operation;
      assert.equal(op.actorId, 'local-author');
      assert.equal(op.counter, v.revision);
      assert.equal(op.field, 'proposal');
      assert.equal(op.kind, 'draft-scenario');
      assert.equal(op.value.features.length, 0);
      assert.ok(op.value.assumptions.includes(v.description));
      assert.ok(op.value.assumptions.includes(JSON.stringify(v.parameters)));
      assert.deepEqual(
        op,
        createPlanningAlternativeOperation(third.project, {
          operationId: op.id,
          actorId: 'local-author',
          counter: v.revision,
          alternativeId: a.id,
          title: v.title,
          features: [],
          assumptions: [v.description, JSON.stringify(v.parameters)],
        }),
      );
    }
  assert.equal(new Set(ops.map((op) => op.id)).size, ops.length);
  const replayed = replayCityDocument(third);
  assert.deepEqual(
    replayed,
    applyCollaborationOperations(createCollaborationState(), ops),
  );
  assert.ok(replayed.results.every((r) => r.accepted));
  assert.deepEqual(replayed.state.authority, {});
  assert.deepEqual(replayed.state.authorizationReceipts, {});
  assert.deepEqual(replayed.state.claims, []);
  const kernel = listPlanningAlternatives(third.project, replayed.state);
  assert.equal(kernel.length, 2);
  assert.equal(
    kernel.find((v) => v.alternativeId === 'green').title,
    'More shade',
  );
  assert.equal(kernel[0].authorship.actorId, 'local-author');
  const latest = cityAlternatives(third);
  assert.equal(latest[0].id, 'green');
  assert.equal(latest[0].revision, 2);
  assert.equal(latest[0].versionCount, 2);
  assert.equal(latest[0].title, 'More shade');
  assert.ok(Object.isFrozen(latest[0].parameters));
  assert.deepEqual(parseCityDocument(serializeCityDocument(third)), third);
});

test('stale, nonexistent, duplicate and malformed edits reject without changing history', () => {
  const first = populated();
  const next = reviseCityAlternative(first, 'green', 1, {
    title: 'Next',
    description: 'Next hypothesis',
    parameters: parameters(),
  });
  for (const revision of [0, 1, 3, '2', NaN]) {
    assert.throws(() =>
      reviseCityAlternative(next, 'green', revision, {
        title: 'Bad',
        description: 'Stale',
        parameters: parameters(),
      }),
    );
    assert.throws(() => attachCityConcept(next, 'green', revision, concept()));
  }
  assert.throws(() =>
    reviseCityAlternative(first, 'missing', 1, alternative()),
  );
  assert.throws(() => attachCityConcept(first, 'missing', 1, concept()));
  assert.throws(() => addCityAlternative(first, alternative()));
  assert.throws(() =>
    addCityAlternative(first, { ...alternative('new'), approval: 'approved' }),
  );
  assert.equal(first.alternatives[0].versions.length, 1);
});

test('concepts keep fixed labeling and exact captured provenance without becoming proposals', () => {
  const original = populated();
  const input = concept();
  const attached = attachCityConcept(original, 'green', 1, input);
  input.sourceView.camera.alt = 1;
  const stored = cityAlternatives(attached)[0].concept;
  assert.equal(stored.label, LABEL);
  assert.equal(stored.sourceView.camera.alt, 500);
  assert.equal(cityAlternatives(original)[0].concept, null);
  assert.deepEqual(replayCityDocument(attached), replayCityDocument(original));
  assert.deepEqual(
    parseCityDocument(serializeCityDocument(attached)),
    attached,
  );
  const revised = reviseCityAlternative(attached, 'green', 1, {
    title: 'Changed',
    description: 'New hypothesis',
    parameters: parameters(),
  });
  assert.equal(cityAlternatives(revised)[0].concept, null);
  assert.equal(revised.alternatives[0].versions[0].concept.label, LABEL);
  for (const mutate of [
    (c) => {
      c.sourceView.bounds[0] += 0.01;
    },
    (c) => {
      c.sourceView.sources[0].revision = 'other';
    },
    (c) => {
      c.sourceView.camera.alt++;
    },
    (c) => {
      c.sourceView.image = JPEG;
    },
    (c) => {
      c.label = 'Approved plan';
    },
    (c) => {
      c.approval = 'approved';
    },
    (c) => {
      c.generatedAt = 'yesterday';
    },
  ]) {
    const invalid = concept();
    mutate(invalid);
    assert.throws(() => attachCityConcept(original, 'green', 1, invalid));
  }
  rejectImport((d) => {
    d.alternatives[0].versions[0].concept.label = 'Approved';
  }, attached);
  rejectImport((d) => {
    delete d.alternatives[0].versions[0].concept.label;
  }, attached);
});

test('one bounded parameter schema applies to every kind', () => {
  for (const kind of ['park', 'bike-lane', 'plaza']) {
    const doc = addCityAlternative(document(), {
      ...alternative(),
      parameters: { kind, trees: 0, widthMeters: 0.5, shadePercent: 0 },
    });
    const max = reviseCityAlternative(doc, 'green', 1, {
      title: 'Max',
      description: 'Boundary values',
      parameters: { kind, trees: 200, widthMeters: 20, shadePercent: 100 },
    });
    assert.equal(cityAlternatives(max)[0].parameters.kind, kind);
  }
  for (const [key, value] of [
    ['kind', 'road'],
    ['trees', -1],
    ['trees', 201],
    ['trees', 1.5],
    ['widthMeters', 0.49],
    ['widthMeters', 20.01],
    ['widthMeters', Infinity],
    ['widthMeters', '2'],
    ['shadePercent', -1],
    ['shadePercent', 101],
    ['shadePercent', 1.5],
  ]) {
    assert.throws(() =>
      addCityAlternative(document(), {
        ...alternative(),
        parameters: { ...parameters(), [key]: value },
      }),
    );
  }
  assert.throws(() =>
    addCityAlternative(document(), {
      ...alternative(),
      parameters: { ...parameters(), extra: true },
    }),
  );
});

test('imports reject authority injection, unsupported schemas and all altered proposal fields', () => {
  const mutations = [
    (d) => {
      d.authority = {};
    },
    (d) => {
      d.authored = {};
    },
    (d) => {
      d.authorizationReceipts = {};
    },
    (d) => {
      d.schemaVersion = 2;
    },
    (d) => {
      d.kind = 'community-planning';
    },
    (d) => {
      d.project.approval = 'approved';
    },
    (d) => {
      d.project.implementation = 'started';
    },
    (d) => {
      d.project.baseline.state = true;
    },
    (d) => {
      d.project.place.bounds[0] += 0.01;
    },
    (d) => {
      d.project.baseline.sources[0].revision = 'other';
    },
    (d) => {
      d.reference.sources[0].extra = true;
    },
    (d) => {
      d.reference.camera.extra = true;
    },
    (d) => {
      d.alternatives[0].authority = {};
    },
    (d) => {
      d.alternatives[0].versions[0].extra = true;
    },
    (d) => {
      d.alternatives[0].versions[0].revision = 2;
    },
    (d) => {
      d.alternatives[0].versions[0].parentRevision = 0;
    },
    (d) => {
      d.alternatives[0].versions[0].title = 'Unrecorded edit';
    },
    (d) => {
      d.alternatives[0].versions[0].parameters.trees++;
    },
    (d) => {
      d.alternatives[0].versions[0].operation = null;
    },
    (d) => {
      d.alternatives[0].versions = [];
    },
    (d) => {
      d.alternatives.push(copy(d.alternatives[0]));
    },
  ];
  for (const mutate of mutations) rejectImport(mutate);
  for (const [key, value] of [
    ['kind', 'action-approval'],
    ['field', 'authority'],
    ['actorId', 'official'],
    ['counter', 0],
    ['id', 'different'],
    ['targetId', 'official'],
    ['payload', {}],
    ['receiptId', 'receipt'],
  ]) {
    rejectImport((d) => {
      d.alternatives[0].versions[0].operation[key] = value;
    });
  }
  for (const [key, value] of [
    ['state', 'approved'],
    ['approval', true],
    ['modeledImpact', 'evaluated'],
    ['features', [{ id: 'tree' }]],
    ['assumptions', []],
    ['baselineRevision', 'other'],
    ['authority', {}],
  ]) {
    rejectImport((d) => {
      d.alternatives[0].versions[0].operation.value[key] = value;
    });
  }
});

test('citations use kernel URL policy and cannot be stripped or promoted', () => {
  for (const url of [
    'http://example.org/a',
    'https://localhost/a',
    'https://192.168.1.1/a',
    'https://example.org/a?token=secret',
    'https://user:password@example.org/a',
    'javascript:alert(1)',
  ]) {
    const ref = reference();
    ref.sources[0].url = url;
    assert.throws(() =>
      createCityDocument({ id: 'city', title: 'City', reference: ref }),
    );
  }
  for (const mutate of [
    (r) => {
      delete r.sources[0].license;
    },
    (r) => {
      r.sources.push(copy(r.sources[0]));
    },
    (r) => {
      r.sources[0].revision = '';
    },
    (r) => {
      r.sources[0].approval = true;
    },
  ]) {
    const ref = reference();
    mutate(ref);
    assert.throws(() =>
      createCityDocument({ id: 'city', title: 'City', reference: ref }),
    );
  }
  rejectImport((d) => {
    d.reference.sources = [];
  });
});

test('malformed, sparse, non-JSON, invalid reference and oversized inputs fail closed', () => {
  for (const value of ['', '{', 'null', '[]', 'true', '{}', 12, null, {}])
    assert.throws(() => parseCityDocument(value));
  for (const mutate of [
    (r) => {
      r.bounds = [-88, 40, -89, 41];
    },
    (r) => {
      r.bounds = new Array(4);
    },
    (r) => {
      r.sources = new Array(1);
    },
    (r) => {
      r.camera.lat = 91;
    },
    (r) => {
      r.camera.lon = -181;
    },
    (r) => {
      r.camera.alt = Infinity;
    },
    (r) => {
      r.camera.pitch = NaN;
    },
    (r) => {
      r.camera.lat = '40';
    },
    (r) => {
      r.capturedAt = '2026-02-30T12:00:00.000Z';
    },
    (r) => {
      r.image = 'data:image/svg+xml;base64,PHN2Zy8+';
    },
    (r) => {
      r.image = 'data:image/webp;base64,UklGRg==';
    },
    (r) => {
      r.image = 'https://example.org/image.png';
    },
    (r) => {
      r.image = 'data:image/png;base64,/9j/2Q==';
    },
    (r) => {
      r.image = 'data:image/jpeg;base64,iVBORw0KGgo=';
    },
    (r) => {
      r.image = 'data:image/png;base64,iVBORw0KGgo=%%%';
    },
    (r) => {
      r.image = 'data:image/png;base64,iVBORw0KGgp=';
    },
    (r) => {
      r.image = PNG + 'A'.repeat(600_000);
    },
  ]) {
    const ref = reference();
    mutate(ref);
    assert.throws(() =>
      createCityDocument({ id: 'city', title: 'City', reference: ref }),
    );
  }
  for (const mutate of [
    (d) => {
      d.alternatives = new Array(1);
    },
    (d) => {
      d.alternatives[0].versions = new Array(1);
    },
    (d) => {
      d.reference.bounds[0] = NaN;
    },
    (d) => {
      d.reference.camera = Object.create({ lat: 40 });
    },
    (d) => {
      d.extra = undefined;
    },
    (d) => {
      d.toJSON = () => ({});
    },
    (d) => {
      Object.defineProperty(d, 'extra', {
        get() {
          throw new Error('must not invoke getter');
        },
        enumerable: true,
      });
    },
  ]) {
    const doc = copy(populated());
    mutate(doc);
    assert.throws(() => serializeCityDocument(doc));
    assert.throws(() => replayCityDocument(doc));
    assert.throws(() => cityAlternatives(doc));
  }
  assert.throws(() => parseCityDocument(' '.repeat(4 * 1024 * 1024 + 1)));
  assert.throws(() => parseCityDocument('"' + '界'.repeat(1_500_000) + '"'));
});

test('all alternatives and revisions are bounded and operation identities remain unique for long ids', () => {
  let doc = document();
  for (let i = 0; i < 6; i++)
    doc = addCityAlternative(doc, alternative('a'.repeat(63) + i));
  assert.throws(() => addCityAlternative(doc, alternative('seventh')));
  const id = doc.alternatives[0].id;
  for (let revision = 1; revision < 20; revision++)
    doc = reviseCityAlternative(doc, id, revision, {
      title: `Version ${revision + 1}`,
      description: 'Revision hypothesis',
      parameters: parameters(),
    });
  assert.throws(() =>
    reviseCityAlternative(doc, id, 20, {
      title: 'Overflow',
      description: 'No',
      parameters: parameters(),
    }),
  );
  const ops = doc.alternatives.flatMap((a) =>
    a.versions.map((v) => v.operation),
  );
  assert.equal(new Set(ops.map((op) => op.id)).size, ops.length);
  assert.ok(ops.every((op) => /^[a-z][a-z0-9-]{0,63}$/.test(op.id)));
  assert.deepEqual(parseCityDocument(serializeCityDocument(doc)), doc);
  rejectImport((d) => {
    d.alternatives.push(copy(d.alternatives[0]));
  }, doc);
  rejectImport((d) => {
    d.alternatives[0].versions.push(copy(d.alternatives[0].versions[19]));
  }, doc);
});

test('raster size and combined document byte limits hold on every public boundary', () => {
  const bytes = Buffer.alloc(449_982);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const image = `data:image/png;base64,${bytes.toString('base64')}`;
  assert.equal(image.length, 599_998);
  const ref = { ...reference(), image };
  let doc = createCityDocument({
    id: 'large',
    title: 'Large fixture',
    reference: ref,
  });
  assert.equal(
    parseCityDocument(serializeCityDocument(doc)).reference.image,
    image,
  );
  const tooLarge = { ...ref, image: image + 'AAAA' };
  assert.throws(() =>
    createCityDocument({ id: 'large', title: 'Large', reference: tooLarge }),
  );
  const largeConcept = { ...concept(), sourceView: ref, image };
  for (const id of ['first', 'second']) {
    doc = addCityAlternative(doc, alternative(id));
    doc = attachCityConcept(doc, id, 1, largeConcept);
  }
  doc = addCityAlternative(doc, alternative('third'));
  assert.throws(() => attachCityConcept(doc, 'third', 1, largeConcept));
  assert.equal(cityAlternatives(doc)[2].concept, null);
  const oversized = copy(doc);
  oversized.alternatives[2].versions[0].concept = copy(
    oversized.alternatives[0].versions[0].concept,
  );
  assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > 4 * 1024 * 1024);
  assert.throws(() => parseCityDocument(JSON.stringify(oversized)));
  assert.throws(() => serializeCityDocument(oversized));
  assert.throws(() => replayCityDocument(oversized));
  assert.throws(() => cityAlternatives(oversized));
});

test('key order is irrelevant but omitted, inherited and extra keys are never repaired', () => {
  const doc = copy(populated());
  doc.reference.camera = Object.fromEntries(
    Object.entries(doc.reference.camera).reverse(),
  );
  doc.alternatives[0].versions[0].parameters = Object.fromEntries(
    Object.entries(parameters()).reverse(),
  );
  assert.deepEqual(parseCityDocument(JSON.stringify(doc)), populated());
  rejectImport((d) => {
    delete d.alternatives[0].versions[0].concept;
  });
  const polluted = copy(doc);
  Object.setPrototypeOf(polluted.reference, { authority: true });
  assert.throws(() => serializeCityDocument(polluted));
  const inherited = Object.create(document());
  assert.throws(() => serializeCityDocument(inherited));
});

// Play mode: an alternative may carry the plot it reimagines and that plot's own captured view.
function plotReference() {
  return {
    ...reference(),
    camera: {
      lat: 40.04,
      lon: -88.16,
      alt: 320,
      heading: 15,
      pitch: -35,
      roll: 0,
    },
    bounds: [-88.17, 40.045, -88.14, 40.07],
    capturedAt: '2026-11-12T12:00:00.000Z',
  };
}
function sited(site, id = 'plot-world') {
  return { ...alternative(id), site };
}

test('a sited alternative keeps its snapped plot and own captured view through history, export and import', async () => {
  const { snapPlot } = await import('./cityPlot.js');
  const plot = snapPlot({ lat: 40.05, lon: -88.155 });
  const own = plotReference();
  const doc = addCityAlternative(populated(), sited({ plot, reference: own }));
  const [, latest] = cityAlternatives(doc);
  assert.deepEqual(latest.site.plot, plot);
  assert.deepEqual(latest.site.reference, own);
  assert.equal(
    cityAlternatives(doc)[0].site,
    null,
    'unsited alternatives stay unsited',
  );
  assert.equal(Object.hasOwn(doc.alternatives[0], 'site'), false);
  // The concept's provenance must be the plot's own capture, not the project baseline.
  assert.throws(() => attachCityConcept(doc, 'plot-world', 1, concept()));
  const attached = attachCityConcept(doc, 'plot-world', 1, {
    ...concept(),
    sourceView: own,
  });
  assert.deepEqual(cityAlternatives(attached)[1].concept.sourceView, own);
  // Reroll: a new version on the same plot keeps the site and accepts a new concept.
  const { id: _ignored, ...edit } = alternative('x');
  const rerolled = reviseCityAlternative(attached, 'plot-world', 1, edit);
  assert.deepEqual(cityAlternatives(rerolled)[1].site, latest.site);
  const second = attachCityConcept(rerolled, 'plot-world', 2, {
    ...concept(),
    sourceView: own,
  });
  assert.equal(cityAlternatives(second)[1].versionCount, 2);
  const text = serializeCityDocument(second);
  assert.deepEqual(parseCityDocument(text), second);
  // A null site reference means the project baseline was captured for this plot.
  const first = addCityAlternative(
    document(),
    sited({ plot: snapPlot({ lat: 40.05, lon: -88.15 }), reference: null }),
  );
  attachCityConcept(first, 'plot-world', 1, concept());
});

test('sites reject edited plots, plots outside their captured view and extra keys', async () => {
  const { snapPlot } = await import('./cityPlot.js');
  const plot = snapPlot({ lat: 40.05, lon: -88.155 });
  const base = addCityAlternative(
    populated(),
    sited({ plot, reference: plotReference() }),
  );
  rejectImport((d) => {
    d.alternatives[1].site.plot.corners[0][0] += 0.0001;
  }, base);
  rejectImport((d) => {
    d.alternatives[1].site.extra = true;
  }, base);
  rejectImport((d) => {
    d.alternatives[1].site = null;
  }, base);
  rejectImport((d) => {
    d.alternatives[1].site.reference.image = 'data:image/png;base64,AAAA';
  }, base);
  const outside = snapPlot({ lat: 41, lon: -88.155 });
  assert.throws(() =>
    addCityAlternative(
      populated(),
      sited({ plot: outside, reference: plotReference() }),
    ),
  );
  assert.throws(() =>
    addCityAlternative(populated(), sited({ plot: outside, reference: null })),
  );
  assert.throws(() =>
    addCityAlternative(
      populated(),
      sited({ plot, reference: plotReference(), x: 1 }),
    ),
  );
});

test('a park or plaza site is an optional proposal parameter; documents without it still import', () => {
  const placed = addCityAlternative(document(), {
    ...alternative(),
    parameters: { ...parameters(), site: 'site-b' },
  });
  assert.equal(cityAlternatives(placed)[0].parameters.site, 'site-b');
  assert.deepEqual(parseCityDocument(serializeCityDocument(placed)), placed);
  const moved = reviseCityAlternative(placed, 'green', 1, {
    title: 'Moved',
    description: 'Same park, another candidate site.',
    parameters: { ...parameters(), site: null },
  });
  assert.equal(cityAlternatives(moved)[0].parameters.site, null);
  assert.equal(moved.alternatives[0].versions[0].parameters.site, 'site-b');
  // Documents saved before sites existed keep their exact v1 shape.
  assert.equal('site' in cityAlternatives(populated())[0].parameters, false);
  assert.deepEqual(
    parseCityDocument(serializeCityDocument(populated())),
    populated(),
  );
  for (const site of ['', 'Site B', 7, {}, `s${'x'.repeat(64)}`]) {
    assert.throws(() =>
      addCityAlternative(document(), {
        ...alternative(),
        parameters: { ...parameters(), site },
      }),
    );
  }
  rejectImport((d) => {
    d.alternatives[0].versions[0].parameters.site = 'site-b';
  });
});

test('a proposed land use per plot is optional, validated, replaceable and removable', () => {
  assert.deepEqual(CITY_LAND_USES, [
    'housing',
    'mixed-use',
    'civic',
    'open-space',
  ]);
  const doc = createCityDocument({
    id: 'zoning',
    title: 'Zoning',
    reference: reference(),
  });
  assert.deepEqual(cityZoning(doc), []);
  assert.equal(
    Object.hasOwn(JSON.parse(serializeCityDocument(doc)), 'zoning'),
    false,
    'unzoned documents keep their v1 bytes',
  );
  const a = snapPlot({ lat: 40.05, lon: -88.15 });
  const b = snapPlot({ lat: 40.0505, lon: -88.15 });
  let next = setCityZoning(doc, a, 'housing');
  next = setCityZoning(next, b, 'open-space');
  assert.deepEqual(
    cityZoning(next).map((z) => [z.plot.id, z.use]),
    [
      [a.id, 'housing'],
      [b.id, 'open-space'],
    ],
  );
  // Changing a plot's use replaces it; null clears it.
  next = setCityZoning(next, a, 'civic');
  assert.deepEqual(
    cityZoning(next)
      .map((z) => z.use)
      .sort(),
    ['civic', 'open-space'],
  );
  const round = parseCityDocument(serializeCityDocument(next));
  assert.deepEqual(cityZoning(round), cityZoning(next));
  const cleared = setCityZoning(setCityZoning(next, a, null), b, null);
  assert.equal(
    serializeCityDocument(cleared),
    serializeCityDocument(doc),
    'clearing every use restores the unzoned bytes',
  );
  assert.throws(() => setCityZoning(doc, a, 'industrial'), /land use/);
  assert.throws(() => setCityZoning(doc, { ...a, row: a.row + 1 }, 'housing'));
  const json = JSON.parse(serializeCityDocument(next));
  for (const zoning of [
    [],
    [...json.zoning, json.zoning[0]],
    [{ ...json.zoning[0], height: 12 }],
    [{ ...json.zoning[0], use: 'industrial' }],
  ])
    assert.throws(() => parseCityDocument(JSON.stringify({ ...json, zoning })));
});
