import '../ui/styles/city-look-r1.css';
import { pageLookFlags } from '../data/cityLookFlags.js';

// FORK-ONLY experiment (exp/city-loop-r1): mounts what the round-1 switches
// ask for on this page (src/data/cityLookFlags.js). The look is a Cesium post
// chain; the chip and tray are layout switches on <body> read by
// city-look-r1.css. ghost / flat / kit are read where play mode and massing draw.
export const LOOK_BODY_CLASS = {
  chip: 'gev-city-r1-chip',
  tray: 'gev-city-r1-tray',
};

export function mountCityLookR1({
  viewer,
  flags = pageLookFlags(),
  doc = globalThis.document,
  win = globalThis.window,
}) {
  const undo = [];
  for (const [flag, cls] of Object.entries(LOOK_BODY_CLASS)) {
    if (!flags[flag] || !doc?.body) continue;
    doc.body.classList.add(cls);
    undo.push(() => doc.body.classList.remove(cls));
  }
  let look = null;
  if (flags.look === 'cozy' && viewer?.scene)
    import('./cozyValleyLook.js')
      .then(({ installCozyValleyLook }) => {
        if (undo.disposed) return;
        const q = new URLSearchParams(win?.location?.search ?? '');
        look = installCozyValleyLook(viewer, {
          wipe: Number(q.get('lookWipe') ?? 0) || 0,
        });
        if (win) win.__gevCozyValley = look;
      })
      .catch(() => console.error('Cozy Valley look failed to load'));
  // FORK-ONLY (exp/city-look-diorama): ?look=diorama, the low-poly district.
  let diorama = null;
  if (flags.look === 'diorama' && viewer?.scene)
    import('./cityDiorama.js')
      .then(({ mountCityDiorama }) => mountCityDiorama({ viewer, win }))
      .then((d) => {
        diorama = d;
        if (undo.disposed) d.remove();
      })
      .catch((e) => {
        if (win) win.__gevDioramaError = String(e?.stack ?? e);
        console.error('Diorama look failed to load', e);
      });
  return {
    flags,
    destroy() {
      undo.disposed = true;
      diorama?.remove();
      look?.remove();
      if (win?.__gevCozyValley === look) delete win.__gevCozyValley;
      for (const f of undo.splice(0)) f();
    },
  };
}
