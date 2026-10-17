/**
 * Local, reversible scenario markers. These are hypotheses, not traffic or
 * climate predictions; compute-backed receipts can replace them later.
 */
export const PROPOSAL_TYPES = Object.freeze([
  ['park', 'Park'],
  ['cooling-center', 'Cooling center'],
  ['bridge', 'Bridge'],
  ['road-closure', 'Road closure'],
]);
const CATEGORIES = new Set(PROPOSAL_TYPES.map(([id]) => id));

export function createProposal({ scenario, type, lat, lon }) {
  if (!['A', 'B'].includes(scenario) || !CATEGORIES.has(type) ||
      !Number.isFinite(lat) || !Number.isFinite(lon) ||
      Math.abs(lat) > 90 || Math.abs(lon) > 180)
    throw new TypeError('Invalid hypothetical proposal');
  return Object.freeze({
    scenario, type,
    lat: Number(lat.toFixed(5)),
    lon: Number(lon.toFixed(5)),
  });
}

export function makeScenarioReceipt(proposals, generatedAt) {
  return {
    schema: 'gev.hypothetical-proposals.v1',
    generatedAt,
    provenance: 'User-authored hypothetical placements; no impact model was run.',
    modeledOutcomes: false,
    scenarios: {
      A: proposals.filter((entry) => entry.scenario === 'A'),
      B: proposals.filter((entry) => entry.scenario === 'B'),
    },
  };
}

export const feature = {
  id: 'world-builder',
  title: 'What-if',
  mount({ root, services }) {
    const { Cesium, viewer } = services;
    const doc = root.ownerDocument;
    const title = doc.createElement('h3');
    title.textContent = 'What-if World Builder';
    const intro = doc.createElement('p');
    intro.textContent = 'Place alternative ideas at the center of your map. No forecast or claimed benefits — just a reversible planning sketch.';
    const controlRow = doc.createElement('div');
    controlRow.className = 'gev-playground-actions';
    const scenarioSelect = doc.createElement('select');
    scenarioSelect.setAttribute('aria-label', 'Scenario branch');
    for (const key of ['A', 'B']) {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = 'Scenario ' + key;
      scenarioSelect.append(option);
    }
    const typeSelect = doc.createElement('select');
    typeSelect.setAttribute('aria-label', 'Proposal type');
    for (const [key, name] of PROPOSAL_TYPES) {
      const option = doc.createElement('option');
      option.value = key;
      option.textContent = name;
      typeSelect.append(option);
    }
    controlRow.append(scenarioSelect, typeSelect);
    const buttons = doc.createElement('div');
    buttons.className = 'gev-playground-actions';
    function button(label) {
      const node = doc.createElement('button');
      node.type = 'button';
      node.textContent = label;
      buttons.append(node);
      return node;
    }
    const add = button('Add at crosshair');
    const undo = button('Undo');
    const exportButton = button('Export JSON');
    const count = doc.createElement('p');
    count.className = 'gev-playground-muted';
    const status = doc.createElement('p');
    status.className = 'gev-playground-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Pan the globe to select a location.';
    const items = [];
    function update() {
      const selected = scenarioSelect.value;
      for (const item of items) item.entity.show = item.proposal.scenario === selected;
      count.textContent = 'A: ' + items.filter((item) => item.proposal.scenario === 'A').length +
        ' markers · B: ' + items.filter((item) => item.proposal.scenario === 'B').length +
        ' markers (showing ' + selected + ')';
      viewer.scene.requestRender();
    }
    function centerCoordinates() {
      const canvas = viewer.scene.canvas;
      const position = viewer.camera.pickEllipsoid(
        new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2),
        Cesium.Ellipsoid.WGS84,
      );
      if (!position) return null;
      const c = Cesium.Cartographic.fromCartesian(position);
      return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude) };
    }
    add.addEventListener('click', () => {
      const center = centerCoordinates();
      if (!center) {
        status.textContent = 'No globe intersection at the crosshair. Try zooming out.';
        return;
      }
      const proposal = createProposal({
        scenario: scenarioSelect.value,
        type: typeSelect.value,
        ...center,
      });
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(proposal.lon, proposal.lat),
        point: {
          pixelSize: 11,
          color: proposal.scenario === 'A' ? Cesium.Color.LIME : Cesium.Color.CYAN,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: 200000,
        },
        label: {
          text: proposal.scenario + ' · ' + PROPOSAL_TYPES.find(([id]) => id === proposal.type)[1],
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          showBackground: true,
          pixelOffset: new Cesium.Cartesian2(0, -23),
          disableDepthTestDistance: 200000,
        },
      });
      items.push({ proposal, entity });
      update();
      status.textContent = proposal.type + ' proposed at ' + proposal.lat + ', ' + proposal.lon + '.';
    });
    undo.addEventListener('click', () => {
      const index = items.findLastIndex(({ proposal }) => proposal.scenario === scenarioSelect.value);
      if (index < 0) {
        status.textContent = 'No proposals to undo in this branch.';
        return;
      }
      viewer.entities.remove(items[index].entity);
      items.splice(index, 1);
      update();
      status.textContent = 'Last proposal undone.';
    });
    scenarioSelect.addEventListener('change', update);
    exportButton.addEventListener('click', () => {
      const receipt = makeScenarioReceipt(items.map(({ proposal }) => proposal), new Date().toISOString());
      const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }));
      const link = doc.createElement('a');
      link.href = url;
      link.download = 'gev-what-if.json';
      link.click();
      URL.revokeObjectURL(url);
      status.textContent = 'Exported hypothetical proposals. No predictions included.';
    });
    root.append(title, intro, controlRow, buttons, count, status);
    update();
    return () => {
      for (const { entity } of items) viewer.entities.remove(entity);
      viewer.scene.requestRender();
    };
  },
};
