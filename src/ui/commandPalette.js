import { msg, t } from '../i18n/index.js';
import { voiceLayer, VOICE_TOGGLE_LAYER_IDS } from '../voice/layerManifest.js';
import {
  LAYER_NAME_KEYS,
  PANEL_LABEL_KEYS,
  shownLayerName,
} from './layerNames.js';
import {
  DEFAULT_COMMAND_CATALOG,
  createCommandCatalog,
  searchCommandCatalog,
} from './commandCatalog.js';

const toggleIds = new Set(VOICE_TOGGLE_LAYER_IDS);

function layerEntries(layers) {
  return layers
    .filter(
      (layer) => toggleIds.has(layer.id) && layer.showInTogglePanel !== false,
    )
    .map((layer) => ({
      id: `layer:${layer.id}`,
      label:
        PANEL_LABEL_KEYS[layer.id] || LAYER_NAME_KEYS[layer.id] || layer.name,
      group: msg('Layers'),
      keywords: [
        layer.id,
        layer.name,
        layer.source,
        layer.enabled ? 'disable' : 'enable',
        t(layer.enabled ? msg('Disable {name}') : msg('Enable {name}'), {
          name: shownLayerName(layer.name, layer.id),
        }),
        ...voiceLayer(layer.id).aliases,
      ]
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim().slice(0, 80)),
      action: {
        name: 'set_layer_visibility',
        args: { layerId: layer.id, enabled: !layer.enabled },
      },
    }));
}

/** Translate message keys once; layer state is an explicit action target, not a toggle. */
export function paletteCommandLabel(command) {
  const { name, args } = command.action;
  return name === 'set_layer_visibility'
    ? t(args.enabled ? msg('Enable {name}') : msg('Disable {name}'), {
        name: shownLayerName(command.label, args.layerId),
      })
    : t(command.label);
}

/** Plain P only. Browser shortcuts, editing and an active modal keep their keys. */
export function isPaletteShortcut(event) {
  return (
    event.key?.toLowerCase() === 'p' &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.repeat &&
    !event.isComposing &&
    !event.target?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], dialog[open]',
    )
  );
}

/** Palette interaction over snapshots and the existing typed runner, without DOM or layer ownership. */
export function createCommandPalette({ getLayers, run, publish }) {
  let open = false;
  let query = '';
  let results = [];
  let selected = -1;
  let pending = false;
  let error = '';
  let destroyed = false;
  let opening = 0;
  const abort = new AbortController();

  const present = () =>
    publish({ open, query, results, selected, pending, error });
  const refresh = () => {
    if (destroyed || !open || pending) return;
    const catalog = [
      ...DEFAULT_COMMAND_CATALOG,
      ...createCommandCatalog(layerEntries(getLayers())),
    ];
    results = searchCommandCatalog(catalog, query, { limit: 50 });
    selected = results.length ? 0 : -1;
    present();
  };
  const close = () => {
    if (destroyed || !open) return;
    open = false;
    opening += 1;
    present();
  };
  present();

  return {
    open() {
      if (destroyed || open) return;
      open = true;
      opening += 1;
      if (pending) present();
      else {
        query = '';
        error = '';
        refresh();
      }
    },
    close,
    refresh,
    setQuery(value) {
      if (destroyed || !open || pending) return;
      query = String(value).slice(0, 256);
      error = '';
      refresh();
    },
    move(delta) {
      if (destroyed || !open || pending || !results.length) return;
      selected = (selected + delta + results.length) % results.length;
      present();
    },
    async execute(id = results[selected]?.id) {
      if (destroyed || !open || pending) return;
      const command = results.find((entry) => entry.id === id);
      if (!command) return;
      const { name, args } = command.action;
      if (
        name === 'set_layer_visibility' &&
        !getLayers().some(
          (layer) =>
            layer.id === args.layerId && layer.showInTogglePanel !== false,
        )
      ) {
        error = msg('This layer is no longer available. Search again.');
        present();
        return;
      }
      const startedIn = opening;
      pending = true;
      error = '';
      present();
      try {
        const result = await run(name, structuredClone(args), {
          signal: abort.signal,
        });
        if (destroyed) return;
        if (result?.ok !== true) error = msg('Command failed. Try again.');
        else if (startedIn === opening) close();
      } catch {
        if (!destroyed) error = msg('Command failed. Try again.');
      } finally {
        if (!destroyed) {
          pending = false;
          if (open && !error) refresh();
          else present();
        }
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
    },
  };
}
