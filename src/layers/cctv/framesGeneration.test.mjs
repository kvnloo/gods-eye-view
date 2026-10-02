import assert from 'node:assert/strict';
import test from 'node:test';

import { createFrames } from './frames.js';

function fixture() {
  const state = {
    _activeCameraId: 'cam-1',
    _cameraMoving: false,
    _cameraMotionGeneration: 3,
    _projectionStaleFrameDiscards: 0,
  };
  const urls = [];
  const frames = createFrames({
    state,
    services: {},
    parts: {
      model: {
        safeNumber(value, fallback) {
          return Number.isFinite(Number(value)) ? Number(value) : fallback;
        },
      },
    },
    source: {
      getFrameUrl(camera) {
        urls.push(camera.id);
        return '/api/cctv/frame?camera=cam-1';
      },
      getMediaUrl() {
        return '/api/cctv/media?camera=cam-1';
      },
    },
  });
  const runtime = {
    mode: 'image',
    image: { src: '' },
    imageLoading: false,
    imageReady: false,
    imageStamp: 0,
    imageRequestGeneration: 0,
    lastImageRefreshAt: 0,
  };
  const record = { camera: { id: 'cam-1' }, projection: runtime };
  return { state, frames, runtime, record, urls };
}

test('still refresh records the motion generation that admitted the request', () => {
  const f = fixture();
  f.frames.refreshProjectionImage(f.record, true);

  assert.equal(f.runtime.imageRequestGeneration, 3);
  assert.equal(f.runtime.imageLoading, true);
  assert.deepEqual(f.urls, ['cam-1']);
});

test('late still completion from an older camera generation is discarded', () => {
  const f = fixture();
  f.runtime.imageLoading = true;
  f.runtime.imageRequestGeneration = 3;

  // A newer moveStart owns the viewport before this image finishes decoding.
  f.state._cameraMotionGeneration = 4;

  assert.equal(f.frames.acceptProjectionImageLoad(f.runtime), false);
  assert.equal(f.runtime.imageLoading, false);
  assert.equal(f.runtime.imageReady, false);
  assert.equal(f.runtime.imageStamp, 0);
  assert.equal(f.state._projectionStaleFrameDiscards, 1);
});

test('current-generation still completion may publish normally', () => {
  const f = fixture();
  f.runtime.imageLoading = true;
  f.runtime.imageRequestGeneration = 3;

  assert.equal(f.frames.acceptProjectionImageLoad(f.runtime), true);
  assert.equal(f.runtime.imageLoading, false);
  assert.equal(f.runtime.imageReady, true);
  assert.ok(f.runtime.imageStamp > 0);
  assert.equal(f.state._projectionStaleFrameDiscards, 0);
});
