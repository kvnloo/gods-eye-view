import {
  createCommunityPlanningProject,
  createPlanningAlternativeOperation,
} from '../data/communityPlanning.js';
import {
  createCollaborationState,
  applyCollaborationOperations,
} from '../data/collaborationAuthority.js';

/** Synthetic, fixture-only alternative branches; no place inference or network. */
export function createSyntheticCommunityPlanningFixture() {
  const project = createCommunityPlanningProject({
    id: 'synthetic-park',
    title: 'Two proposed park concepts',
    place: {
      label: 'Synthetic neighborhood block — NOT a surveyed parcel',
      bounds: [-88.2, 40, -88.1, 40.1],
    },
    baseline: {
      revision: 'synthetic-parcel-v1',
      sources: [{
        id: 'synthetic-source',
        revision: 'fixture-v1',
        url: 'https://example.org/synthetic-fixture',
        attribution: 'Generated example, not official parcel data',
        license: 'synthetic-test-data',
      }],
    },
  });
  const operations = [
    createPlanningAlternativeOperation(project, {
      operationId: 'alice-trees-v1', actorId: 'alice', counter: 1,
      alternativeId: 'trees-first', title: 'Trees & shade',
      features: [
        { id: 'oak', kind: 'tree', point: [-88.175, 40.065] },
        { id: 'canopy', kind: 'shade', point: [-88.16, 40.05] },
        { id: 'bench', kind: 'seating', point: [-88.18, 40.03] },
      ],
      assumptions: ['No ownership or canopy measurements supplied'],
    }),
    createPlanningAlternativeOperation(project, {
      operationId: 'bob-play-v1', actorId: 'bob', counter: 1,
      alternativeId: 'play-first', title: 'Play & community garden',
      features: [
        { id: 'playground', kind: 'play-area', point: [-88.145, 40.06] },
        { id: 'garden', kind: 'garden', point: [-88.13, 40.035] },
      ],
      assumptions: ['No accessibility or safety survey supplied'],
    }),
  ];
  const collaborationState = applyCollaborationOperations(
    createCollaborationState(), operations,
  ).state;
  return { project, collaborationState };
}
