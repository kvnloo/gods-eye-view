import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerLifecycle } from '../../data/lifecycle.js';
import { readStylesheet } from '../../testSupport/readStylesheet.mjs';
import { createTidesLayer } from './index.js';
import { createTidePanel } from './panel.js';

function createDom() {
  const previous = globalThis.document;
  function element(tag) {
    return {
      tagName: tag.toUpperCase(),
      children: [],
      options: [],
      hidden: false,
      append(...children) {
        this.children.push(...children);
        if (this.tagName === 'SELECT')
          this.options.push(...children.filter((child) => child.tagName === 'OPTION'));
      },
      setAttribute() {},
      addEventListener() {},
      remove() {
        this.removed = true;
      },
    };
  }
  const body = element('body');
  globalThis.document = {
    body,
    activeElement: null,
    createElement: element,
  };
  return {
    body,
    restore() {
      if (previous === undefined) delete globalThis.document;
      else globalThis.document = previous;
    },
  };
}

function eventChannel() {
  const listeners = new Set();
  return {
    listeners,
    addEventListener(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}

test('off-station activation remains enabled through the real layer lifecycle', async () => {
  const dom = createDom();
  const moveEnd = eventChannel();
  const preRender = eventChannel();
  const viewer = {
    camera: {
      positionCartographic: {
        latitude: (40.7 * Math.PI) / 180,
        longitude: (-74 * Math.PI) / 180,
        height: 1_500,
      },
      moveEnd,
    },
    scene: {
      globe: { depthTestAgainstTerrain: false },
      preRender,
    },
  };
  let requests = 0;
  const layer = createTidesLayer({
    source: {
      async getPredictions() {
        requests++;
        throw new Error('no station should request NOAA data');
      },
    },
    now: () => Date.parse('2026-10-01T14:00:00Z'),
    panelParent: dom.body,
  });
  const lifecycle = new LayerLifecycle(viewer);
  lifecycle.register(layer);
  try {
    assert.equal(await lifecycle.setEnabled('coastal-tides', true), true);
    const state = lifecycle.getAll().find((entry) => entry.id === 'coastal-tides');
    assert.equal(state.enabled, true);
    assert.equal(state.stats.count, 0);
    assert.equal(state.stats.error, null);
    assert.equal(requests, 0);
    assert.equal(moveEnd.listeners.size, 1, 'camera navigation remains subscribed');
    assert.equal(preRender.listeners.size, 1);
    assert.equal(dom.body.children[0].hidden, false);
    assert.equal(await lifecycle.setEnabled('coastal-tides', false), true);
    assert.equal(moveEnd.listeners.size, 0);
    assert.equal(preRender.listeners.size, 0);
    assert.equal(dom.body.children[0].hidden, true);
    assert.equal(await lifecycle.setEnabled('coastal-tides', true), true);
    assert.equal(lifecycle.getAll().find((entry) => entry.id === 'coastal-tides').enabled, true);
  } finally {
    await lifecycle.setEnabled('coastal-tides', false);
    layer.destroy();
    dom.restore();
  }
});

test('the tide card stays hidden despite its grid display rule', () => {
  const dom = createDom();
  try {
    const panel = createTidePanel({ handlers: {}, parent: dom.body });
    const card = dom.body.children[0];
    assert.equal(card.hidden, true);
    panel.setVisible(true);
    assert.equal(card.hidden, false);
    panel.setVisible(false);
    assert.equal(card.hidden, true);
    const css = readStylesheet(new URL('../../ui/styles/tides.css', import.meta.url));
    assert.match(css, /\.tides-card\s*\{[^}]*display:\s*grid\s*;/);
    assert.match(css, /\.tides-card\[hidden\]\s*\{[^}]*display:\s*none\s*;/);
    panel.destroy();
  } finally {
    dom.restore();
  }
});
