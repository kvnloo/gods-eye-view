import assert from 'node:assert/strict';
import test from 'node:test';

import { createFrames } from './frames.js';

function fixture({ moving = false } = {}) {
  const urls = [];
  const layerState = {
    _activeCameraId: 'cam-1',
    _cameraMoving: moving,
  };
  const parts = {
    model: {
      safeNumber(value, fallback) {
        return Number.isFinite(Number(value)) ? Number(value) : fallback;
      },
    },
  };
  const source = {
    getFrameUrl(camera) {
      urls.push(camera.id);
      return '/api/cctv/frame?camera=cam-1';
    },
    getMediaUrl() {
      return '/api/cctv/media?camera=cam-1';
    },
  };
  const frames = createFrames({
    state: layerState,
    services: {},
    parts,
    source,
  });
  const image = { src: '' };
  const record = {
    camera: { id: 'cam-1' },
    projection: {
      mode: 'image',
      image,
      imageLoading: false,
      imageReady: true,
      lastImageRefreshAt: 0,
    },
  };
  return { frames, layerState, record, urls, image };
}

test('optional CCTV still refinement yields while the camera is moving', () => {
  const f = fixture({ moving: true });

  f.frames.refreshProjectionImage(f.record);

  assert.deepEqual(f.urls, []);
  assert.equal(f.record.projection.imageLoading, false);
  assert.equal(f.record.projection.lastImageRefreshAt, 0);
  assert.equal(f.image.src, '');
});

test('a forced first-load/failover request may establish the CCTV visual during motion', () => {
  const f = fixture({ moving: true });

  f.frames.refreshProjectionImage(f.record, true);

  assert.deepEqual(f.urls, ['cam-1']);
  assert.equal(f.record.projection.imageLoading, true);
  assert.match(f.image.src, /^\/api\/cctv\/frame\?camera=cam-1&projTs=/);
});

test('optional CCTV still refinement resumes after camera motion settles', () => {
  const f = fixture({ moving: true });

  f.frames.refreshProjectionImage(f.record);
  f.layerState._cameraMoving = false;
  f.frames.refreshProjectionImage(f.record);

  assert.deepEqual(f.urls, ['cam-1']);
  assert.equal(f.record.projection.imageLoading, true);
  assert.ok(f.record.projection.lastImageRefreshAt > 0);
});
