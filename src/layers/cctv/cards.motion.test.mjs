import assert from 'node:assert/strict';
import test from 'node:test';

import { cctvCardRefinementAllowed, createCards } from './cards.js';

function fixture(t, { moving = false } = {}) {
  const images = [];
  let draws = 0;
  let renders = 0;

  class FakeImage {
    constructor() {
      this.onload = null;
      this.onerror = null;
      this._src = '';
      images.push(this);
    }
    set src(value) {
      this._src = value;
    }
    get src() {
      return this._src;
    }
    removeAttribute(name) {
      if (name === 'src') this._src = '';
    }
  }

  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  globalThis.Image = FakeImage;
  globalThis.document = {
    hidden: false,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage() {
              draws += 1;
            },
          };
        },
      };
    },
  };
  t.after(() => {
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
  });

  const state = {
    _cameraMoving: moving,
    _cardFrameSlots: new Map(),
    _cardFetchImages: new Set(),
    _cardFetchPendingIds: new Set(),
    _cardFetchInFlightCount: 0,
    _cardLastFetchAt: 0,
    _cardFetchCount: 0,
    _cardMinFetchSpacingMs: null,
    _cardMotionDeferredLaunches: 0,
    _cardMotionDiscardedSettles: 0,
    _viewer: {
      scene: {
        requestRender() {
          renders += 1;
        },
      },
    },
  };
  const parts = {
    frames: {
      frameUrlFor: () => '/frame',
    },
  };
  const cards = createCards({ state, services: {}, parts, source: {} });
  const record = { camera: { id: 'cam-1' } };
  const slot = cards.ensureCardFrameSlot('cam-1');

  return {
    cards,
    state,
    record,
    slot,
    images,
    draws: () => draws,
    renders: () => renders,
  };
}

test(
  'background CCTV card refinement is not admitted during camera motion',
  (t) => {
    const f = fixture(t, { moving: true });

    f.cards.fetchCardFrame(f.record, f.slot, 1000);

    assert.equal(f.images.length, 0);
    assert.deepEqual(f.cards.cardRefinementStats(), {
      motionDeferredLaunches: 1,
      motionDiscardedSettles: 0,
    });
  },
);

test('a pre-motion CCTV card fetch cannot publish after motion starts', (t) => {
  const f = fixture(t);

  f.cards.fetchCardFrame(f.record, f.slot, 1000);
  assert.equal(f.images.length, 1);
  f.state._cameraMoving = true;
  f.images[0].onload();

  assert.equal(f.draws(), 0);
  assert.equal(f.renders(), 0);
  assert.equal(f.slot.stamp, 0);
  assert.deepEqual(f.cards.cardRefinementStats(), {
    motionDeferredLaunches: 0,
    motionDiscardedSettles: 1,
  });
});

test('explicit CCTV card user gestures remain eligible during motion', (t) => {
  const f = fixture(t, { moving: true });

  assert.equal(
    cctvCardRefinementAllowed({ cameraMoving: true, userGesture: true }),
    true,
  );
  f.cards.fetchCardFrame(f.record, f.slot, 1000, { userGesture: true });
  assert.equal(f.images.length, 1);
});
