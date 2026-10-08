from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {text.count(old)}")
    return text.replace(old, new, 1)


path = Path("src/scenes/director.js")
text = path.read_text()

# An unreadable/newer saved project must not let startup migrations overwrite
# either the saved project or its manual-recovery checkpoint.
start_marker = "    this._bootstrapLegacyShotPacks();\n"
end_marker = "    this._initUI();\n"
start = text.index(start_marker)
end = text.index(end_marker, start)
block = text[start:end]
indented = "".join(
    ("  " + line if line.strip() else line)
    for line in block.splitlines(keepends=True)
)
text = text[:start] + "    if (!this._storageReadError) {\n" + indented + "    }\n" + text[end:]

save_start = text.index("  _saveProject() {")
save_end = text.index('  /** Surface a "scene not saved" notice', save_start)
save = text[save_start:save_end]
save = replace_once(
    save,
    "      );\n      return;\n    }\n    this._project.updatedAt",
    "      );\n      return false;\n    }\n    this._project.updatedAt",
    "read-error save return",
)
save = replace_once(
    save,
    "      localStorage.setItem(STORAGE_KEY, payload);\n",
    "      localStorage.setItem(STORAGE_KEY, payload);\n      return true;\n",
    "successful save return",
)
save = replace_once(
    save,
    "      );\n    }\n  }\n\n",
    "      );\n      return false;\n    }\n  }\n\n",
    "failed save return",
)
text = text[:save_start] + save + text[save_end:]

text = replace_once(
    text,
    """    this._saveProject();
    this._shotOutcome('shot-captured', scene, shot);
    this._updateStatus(`Captured: ${scene.title} / ${shot.title}`);""",
    """    const saved = this._saveProject();
    this._shotOutcome('shot-captured', scene, shot);
    if (saved) this._updateStatus(`Captured: ${scene.title} / ${shot.title}`);""",
    "capture status",
)
text = replace_once(
    text,
    """    this._saveProject();
    this._shotOutcome('shot-updated', scene, shot);
    this._updateStatus(`Updated: ${scene.title} / ${shot.title}`);""",
    """    const saved = this._saveProject();
    this._shotOutcome('shot-updated', scene, shot);
    if (saved) this._updateStatus(`Updated: ${scene.title} / ${shot.title}`);""",
    "update status",
)
text = replace_once(
    text,
    """    this._saveProject();
    if (render) {
      this._renderSceneSelect();
      this._renderShotList();
    }
    if (announce) {""",
    """    const saved = this._saveProject();
    if (render) {
      this._renderSceneSelect();
      this._renderShotList();
    }
    if (announce && saved) {""",
    "append status",
)
text = replace_once(
    text,
    """      this._saveProject();
      this._publish({ type: 'project-imported', project });
      this._updateStatus(`Imported ${file.name}`);
      return true;""",
    """      const saved = this._saveProject();
      this._publish({ type: 'project-imported', project });
      if (saved) this._updateStatus(`Imported ${file.name}`);
      return true;""",
    "import status",
)

text = replace_once(
    text,
    """    let queue = this._buildPlaybackQueue(
      sceneId || this._selectedSceneId || this._project.scenes[0]?.id,
      { single },
    );""",
    """    const startSceneId =
      sceneId || this._selectedSceneId || this._project.scenes[0]?.id;
    let queue = this._buildPlaybackQueue(startSceneId, { single });""",
    "playback start scene",
)
text = replace_once(
    text,
    """        ({ scene, shot }) => scene.id === sceneId && shot.id === afterShotId,
""",
    """        ({ scene, shot }) =>
          scene.id === startSceneId && shot.id === afterShotId,
""",
    "after-shot scene",
)
text = replace_once(
    text,
    "      scenesRun: queue.length,\n",
    "      scenesRun: new Set(queue.map(({ scene }) => scene.id)).size,\n",
    "scene count metadata",
)
text = replace_once(
    text,
    """    } finally {
      this._finishRun();
    }
  }

  /**
   * Advance to the next shot""",
    """    } finally {
      this._finishRun();
    }
    return { started: true, shots: queue.length };
  }

  /**
   * Advance to the next shot""",
    "successful scene result",
)
path.write_text(text)

regression = r'''import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneDirector } from './director.js';

const STORAGE_KEY = 'godsEyeView.sceneProject.v2';
const CHECKPOINT_KEY = 'godsEyeView.sceneProject.checkpoint.v1';
const pose = {
  lat: 10,
  lon: 20,
  alt: 500000,
  heading: 0,
  pitch: -40,
  roll: 0,
};
const shot = (id) => ({
  id,
  title: id,
  durationSec: 0.2,
  holdSec: 0,
  camera: pose,
  visual: { style: 'normal' },
  layers: {},
});
const project = JSON.stringify({
  version: 3,
  scenes: [{ id: 's', title: 'S', shots: [shot('a'), shot('b')] }],
});

function classList() {
  return {
    add() {},
    remove() {},
    toggle() {},
    contains: () => false,
  };
}

function installDocument() {
  globalThis.document = {
    getElementById: () => null,
    createElement: () => ({
      classList: classList(),
      style: {},
      dataset: {},
      appendChild() {},
      remove() {},
      click() {},
      addEventListener() {},
      removeEventListener() {},
      setAttribute() {},
    }),
    addEventListener() {},
    removeEventListener() {},
    body: { classList: classList(), appendChild() {} },
  };
}

function make(initial) {
  const stored = new Map(Object.entries(initial));
  const storage = {
    stored,
    full: false,
    getItem: (key) => stored.get(key) ?? null,
    setItem(key, value) {
      if (this.full)
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      stored.set(key, String(value));
    },
    removeItem: (key) => stored.delete(key),
  };
  globalThis.localStorage = storage;
  const viewer = {
    camera: {
      flyTo: (options) => Promise.resolve().then(() => options.complete?.()),
      cancelFlight() {},
    },
  };
  const style = {
    runImmediateNavigation: (_name, run) => run(),
    getCameraState: () => pose,
    getVisualState: () => ({ style: 'normal' }),
    setRecordingMode() {},
    applyVisualState: async () => true,
  };
  const data = {
    getAll: () => [],
    getLayerParams: () => null,
    setEnabled: async () => true,
    setLayerParams: () => true,
  };
  return { director: new SceneDirector(viewer, style, data), storage };
}

test('SceneDirector keeps recovery data, failed-save status, and run results accurate (#971)', async (t) => {
  const priorDocument = globalThis.document;
  const priorStorage = globalThis.localStorage;
  installDocument();
  t.after(() => {
    if (priorDocument === undefined) delete globalThis.document;
    else globalThis.document = priorDocument;
    if (priorStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = priorStorage;
  });

  let made = make({
    [STORAGE_KEY]: '{"version":99,"scenes":[]}',
    [CHECKPOINT_KEY]: 'EARLIER-CHECKPOINT',
  });
  assert.equal(
    made.storage.stored.get(STORAGE_KEY),
    '{"version":99,"scenes":[]}',
  );
  assert.equal(
    made.storage.stored.get(CHECKPOINT_KEY),
    'EARLIER-CHECKPOINT',
  );
  await made.director.destroy();

  made = make({ [STORAGE_KEY]: project });
  let status = '';
  made.director.subscribe(({ state }) => {
    status = state.status;
  });
  made.storage.full = true;
  made.director.captureShot();
  assert.match(status, /^Scene not saved/);
  await made.director.destroy();

  made = make({ [STORAGE_KEY]: project });
  const options = { single: true, preview: false };
  assert.deepEqual(await made.director.startScene('s', options), {
    started: true,
    shots: 2,
  });
  assert.equal(made.director._lastRun.scenesRun, 1);
  assert.deepEqual(
    await made.director.startScene(undefined, {
      ...options,
      afterShotId: 'a',
    }),
    { started: true, shots: 1 },
  );
  await made.director.destroy();
});
'''
Path("src/scenes/director971.test.mjs").write_text(regression)

scope = Path("scripts/format-scope.json")
scope_text = scope.read_text()
entry = '  "src/scenes/director971.test.mjs",\n'
if entry not in scope_text:
    anchor = '  "src/data/inputOwnership.test.mjs",\n'
    if anchor not in scope_text:
        raise SystemExit("format-scope anchor missing")
    scope_text = scope_text.replace(anchor, anchor + entry, 1)
    scope.write_text(scope_text)
