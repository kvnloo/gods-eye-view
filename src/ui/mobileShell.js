/**
 * Phone shell for narrow viewports (≤720px). The globe stays full screen and a
 * bottom tab bar opens one sheet at a time; each sheet shows existing panels,
 * which stay where they are in the rails and dock while CSS presents them
 * (styles/mobile-shell.css). Desktop never sees the class or the sheet state.
 *
 * Sheets borrow panels: the panels a sheet expands are put back exactly as
 * they were when the sheets close, and nothing a sheet does is persisted or
 * treated as the user's own panel choice.
 *
 * Adapted from the phone tab-shell proposed in public PR #203 by blearymoth.
 */

import { EXCLUSIVE_SURFACE_CLASSES } from '../exclusiveSurfaces.js';
import { msg } from '../i18n/index.js';
import {
  prefersCollapsed as prefersStateCollapsed,
  readPanelState,
} from './rail/panelState.js';

import {
  MOBILE_SHELL_CLASS,
  MOBILE_SHEET_ATTR,
  MOBILE_SHEET_PANELS,
} from './mobileSheets.js';

export {
  MOBILE_SHELL_CLASS,
  MOBILE_SHEET_ATTR,
  MOBILE_SHEET_PANELS,
  sheetForPanelId,
} from './mobileSheets.js';

export const MOBILE_SHELL_MEDIA_QUERY = '(max-width: 720px)';
export const MOBILE_TABS = Object.freeze([
  Object.freeze({ sheet: 'layers', label: msg('Layers'), icon: 'layers' }),
  Object.freeze({ sheet: 'cameras', label: msg('Cameras'), icon: 'videocam' }),
  Object.freeze({ sheet: 'context', label: msg('Context'), icon: 'radar' }),
  Object.freeze({
    sheet: 'missions',
    label: msg('Space Missions'),
    icon: 'rocket_launch',
  }),
  Object.freeze({ sheet: 'search', label: msg('Search'), icon: 'search' }),
  // Not a sheet: Cast opens its own menu (views/panels/CastButton.vue).
  Object.freeze({ action: 'cast', label: msg('Cast'), icon: 'cast' }),
  Object.freeze({ sheet: 'more', label: msg('More'), icon: 'more_horiz' }),
]);

/**
 * The heights an open sheet rests at, smallest first: a peek over the globe,
 * half the screen (where a sheet opens) and the full height under the top bar.
 * Search and More stack the dock over a rail and keep their own heights.
 */
export const MOBILE_SHEET_SNAPS = Object.freeze(['peek', 'half', 'full']);
export const MOBILE_SNAP_ATTR = 'data-mobile-snap';
export const MOBILE_DEFAULT_SNAP = 'half';
/** Sheets whose height the grab handle sets. */
export const MOBILE_RESIZABLE_SHEETS = Object.freeze([
  'layers',
  'cameras',
  'context',
]);
/** Vertical travel before a drag on the handle is a resize, not a tap. */
export const MOBILE_DRAG_CLAIM_PX = 8;

/**
 * Pixel heights of the snaps for a viewport, as mobile-shell.css sizes them.
 * @param {number} viewportHeight
 * @param {{ tabSpace?: number, topInset?: number }} [insets]
 */
export function snapHeights(
  viewportHeight,
  { tabSpace = 58, topInset = 0 } = {},
) {
  const usable = Math.max(0, viewportHeight - tabSpace);
  return {
    peek: Math.round(viewportHeight * 0.3),
    half: Math.round(Math.min(viewportHeight * 0.62, viewportHeight - 168)),
    full: Math.round(Math.max(0, usable - topInset - 64)),
  };
}

/** A tap on the handle: peek → half → full → peek. */
export function nextSnap(snap) {
  const index = MOBILE_SHEET_SNAPS.indexOf(snap);
  return MOBILE_SHEET_SNAPS[(index + 1) % MOBILE_SHEET_SNAPS.length];
}

/**
 * Where a released drag comes to rest. The fling projects the height
 * 180 ms ahead (Sound Atlas's v·0.18); a sheet pulled well under its peek
 * closes.
 * @param {number} height The sheet's height at release, px.
 * @param {number} velocity Height change in px per ms (positive grows).
 * @param {{ peek: number, half: number, full: number }} heights
 * @returns {'peek'|'half'|'full'|null} null closes the sheet.
 */
export function restingSnap(height, velocity, heights) {
  const projected = height + velocity * 180;
  if (projected < heights.peek * 0.6) return null;
  let best = MOBILE_SHEET_SNAPS[0];
  for (const snap of MOBILE_SHEET_SNAPS)
    if (
      Math.abs(heights[snap] - projected) < Math.abs(heights[best] - projected)
    )
      best = snap;
  return best;
}

/**
 * Surfaces that own the screen close the open sheet and keep sheets closed.
 * Scene playback is the exception: its STOP control lives in the Scenes panel
 * (Layers sheet), and a phone has no Escape key to stop it otherwise.
 */
const SHEET_BLOCKING_CLASSES = Object.freeze(
  EXCLUSIVE_SURFACE_CLASSES.filter((name) => name !== 'scene-playback-mode'),
);

/** Every panel any sheet borrows; the dock trays close each other. */
const BORROWED_PANELS = Object.freeze([
  ...new Set(Object.values(MOBILE_SHEET_PANELS).flat()),
]);

const BORROW_OPTIONS = Object.freeze({ persist: false, syncShare: false });

/**
 * The sheet after a tab press: the same tab closes its sheet, another opens.
 * @param {string|null} current
 * @param {string|null} pressed
 * @returns {string|null}
 */
export function nextSheet(current, pressed) {
  if (!pressed || !Object.hasOwn(MOBILE_SHEET_PANELS, pressed)) return null;
  return current === pressed ? null : pressed;
}

function sheetBlocked(body) {
  return SHEET_BLOCKING_CLASSES.some((name) => body.classList.contains(name));
}

function currentSheetOf(body) {
  const value = body.getAttribute(MOBILE_SHEET_ATTR);
  return value && Object.hasOwn(MOBILE_SHEET_PANELS, value) ? value : null;
}

/**
 * Wires the phone shell: the media gate, tab bar, backdrop, Escape, focus,
 * and closing for full-screen modes. The shell publishes its tabs, whether it
 * is on and which sheet is open; Core's dock renders the tab bar and the
 * backdrop at the end of the page from its first publish until it is
 * destroyed, and the shell takes their clicks from the document.
 * @param {object} input
 * @param {(panelId: string, collapsed: boolean, options?: object) => void} input.setPanelCollapsed
 * @param {Document} [input.documentRef]
 * @param {(query: string) => MediaQueryList} [input.matchMedia]
 * @param {typeof MutationObserver} [input.MutationObserverImpl]
 * @param {typeof ResizeObserver} [input.ResizeObserverImpl]
 * @param {(panel: Element) => object} [input.readPanel] A panel's state as its
 *   owner presented it; its classes by default.
 * @param {(callback: () => void) => number} [input.requestFrame]
 * @param {() => void} [input.onSheetsClosed] Runs after the last sheet closes
 *   and its panels are put back (e.g. to refresh the share link).
 * @param {(view: ?{enabled: boolean, sheet: string|null, tabs: typeof MOBILE_TABS}) => void} [input.publish]
 *   Receives the tab bar: whether the shell is on, the open sheet and the
 *   tabs; null once the shell is destroyed.
 * @param {(callback: () => void) => void} [input.afterPublish] Runs a callback
 *   once a publish has rendered, so focus returns to a tab whose state is
 *   already current.
 * @returns {{ destroy: () => void, setSheet: (sheet: string|null) => void, getSheet: () => string|null, sharedCollapsed: (panelId: string) => boolean|undefined }}
 */
export function initMobileShell({
  setPanelCollapsed,
  readPanel = readPanelState,
  documentRef = globalThis.document,
  matchMedia = globalThis.matchMedia?.bind(globalThis),
  MutationObserverImpl = globalThis.MutationObserver,
  ResizeObserverImpl = globalThis.ResizeObserver,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  onSheetsClosed = () => {},
  publish = () => {},
  afterPublish = (callback) => callback(),
} = {}) {
  const body = documentRef.body;
  const viewport = documentRef.querySelector('meta[name="viewport"]');
  const viewportContent = viewport?.getAttribute('content') ?? null;
  const removers = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    removers.push(() => target.removeEventListener(type, handler, options));
  };
  const element = (id) => documentRef.getElementById(id);
  const rails = ['left-panel-stack', 'right-context-rail']
    .map(element)
    .filter(Boolean);
  const dock = element('command-dock');
  const missionsPanel = element('space-missions-panel');
  const shown = (node) =>
    node && globalThis.getComputedStyle?.(node).display !== 'none';

  /**
   * Panel states from before the first sheet opened (`before`) and right after
   * the open sheet was set up (`applied`); null when closed.
   */
  let borrowed = null;
  let returnFocus = null;
  // Opening a sheet or destroying the shell cancels a pending focus return.
  let focusReturns = 0;
  let swipe = null;
  let snap = MOBILE_DEFAULT_SNAP;
  // A drag on the grab handle: { id, y, height, claimed, lastY, lastT, velocity }.
  let grab = null;
  // The click that ends a drag on the handle is not a tap.
  let swallowGrabClick = false;
  const written = new Map();

  const writeVar = (name, value) => {
    if (written.get(name) === value) return;
    written.set(name, value);
    body.style.setProperty(name, value);
  };

  // The dock (Presets, Search) sits on top of whichever rail is the sheet,
  // and the required map attribution sits above everything the sheet covers.
  const measureSheet = () => {
    if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
    const height = Math.max(
      0,
      ...rails.map((rail) =>
        shown(rail) ? rail.getBoundingClientRect().height : 0,
      ),
    );
    writeVar('--mobile-sheet-height', `${Math.round(height)}px`);
    const viewportHeight = globalThis.innerHeight || 0;
    const cover = Math.max(
      0,
      ...[...rails, currentSheetOf(body) ? dock : null]
        .filter(shown)
        .map((node) => viewportHeight - node.getBoundingClientRect().top),
    );
    writeVar('--mobile-sheet-cover', `${Math.round(cover)}px`);
    // The globe actions ride just above the voice dock in the thumb zone.
    if (!currentSheetOf(body) && shown(dock))
      writeVar(
        '--mobile-dock-cover',
        `${Math.round(viewportHeight - dock.getBoundingClientRect().top)}px`,
      );
  };

  const resize =
    typeof ResizeObserverImpl === 'function'
      ? new ResizeObserverImpl(measureSheet)
      : null;
  removers.push(() => resize?.disconnect());

  const isCollapsed = (panelId) => {
    const panel = element(panelId);
    return panel ? readPanel(panel).collapsed : true;
  };
  // The user's preference, as share links record it.
  const prefersCollapsed = (panelId) => {
    const panel = element(panelId);
    return panel ? prefersStateCollapsed(readPanel(panel)) : true;
  };

  const panelStates = () =>
    new Map(
      BORROWED_PANELS.map((panelId) => [panelId, prefersCollapsed(panelId)]),
    );

  // Undo only what opening the sheet did (including side effects, such as dock
  // trays closing each other). A panel the user changed since stays as they
  // left it, and becomes the state later sheets put back.
  const restoreBorrowed = () => {
    if (!borrowed) return;
    for (const [panelId, before] of borrowed.before) {
      const now = prefersCollapsed(panelId);
      if (now !== borrowed.applied.get(panelId))
        borrowed.before.set(panelId, now);
      else if (now !== before)
        setPanelCollapsed(panelId, before, BORROW_OPTIONS);
    }
  };

  const publishChrome = () =>
    publish({
      enabled: body.classList.contains(MOBILE_SHELL_CLASS),
      sheet: currentSheetOf(body),
      snap: resizable(currentSheetOf(body)) ? snap : null,
      tabs: MOBILE_TABS,
    });

  const resizable = (sheet) => MOBILE_RESIZABLE_SHEETS.includes(sheet);

  const present = (sheet) => {
    if (sheet) body.setAttribute(MOBILE_SHEET_ATTR, sheet);
    else body.removeAttribute(MOBILE_SHEET_ATTR);
    if (!sheet) snap = MOBILE_DEFAULT_SNAP;
    if (resizable(sheet)) body.setAttribute(MOBILE_SNAP_ATTR, snap);
    else body.removeAttribute(MOBILE_SNAP_ATTR);
    publishChrome();
    measureSheet();
  };

  const endGrab = () => {
    grab = null;
    body.classList.remove('mobile-sheet-dragging');
    body.style.removeProperty('--mobile-sheet-drag-height');
  };

  /** Rest the open sheet at a snap height; a detent buzz marks the change. */
  const setSnap = (next) => {
    const sheet = currentSheetOf(body);
    if (!resizable(sheet) || !MOBILE_SHEET_SNAPS.includes(next)) return;
    endGrab();
    if (snap === next) return;
    snap = next;
    globalThis.navigator?.vibrate?.(8);
    present(sheet);
  };

  /** The first visible control of the sheet's first panel, for focus on open. */
  const sheetFocusTarget = (sheet) => {
    if (sheet === 'search') return element('location-search');
    const panel = element(MOBILE_SHEET_PANELS[sheet][0]);
    const controls =
      panel?.querySelectorAll?.(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [];
    // Sheets hide some panel chrome (tray toggles, pins) that stays in the
    // DOM, and a panel's own collapse control is a poor first stop.
    return (
      [...controls].find(
        (control) =>
          control.getClientRects().length > 0 &&
          !control.matches?.('.panel-collapse-btn'),
      ) ?? null
    );
  };

  const setSheet = (requested) => {
    swipe = null;
    endGrab();
    if (!body.classList.contains(MOBILE_SHELL_CLASS)) return;
    const unavailableMissions =
      requested === 'missions' && missionsPanel?.hidden;
    const sheet = sheetBlocked(body) || unavailableMissions ? null : requested;
    const previous = currentSheetOf(body);
    if (previous === sheet) return;
    if (!previous) {
      focusReturns += 1;
      borrowed = { before: panelStates(), applied: panelStates() };
      returnFocus = documentRef.activeElement ?? null;
    } else {
      if (previous === 'search') element('location-search')?.blur?.();
      restoreBorrowed();
    }
    present(sheet);
    if (!sheet) {
      borrowed = null;
      onSheetsClosed();
      const focus = returnFocus;
      returnFocus = null;
      // Focus that moved elsewhere meanwhile stays where it went.
      const closedWith = documentRef.activeElement;
      const pending = ++focusReturns;
      afterPublish(() => {
        if (pending !== focusReturns) return;
        if (documentRef.activeElement !== closedWith) return;
        if (focus && focus !== body && body.contains?.(focus)) focus.focus?.();
      });
      return;
    }
    for (const panelId of MOBILE_SHEET_PANELS[sheet])
      if (isCollapsed(panelId))
        setPanelCollapsed(panelId, false, BORROW_OPTIONS);
    borrowed.applied = panelStates();
    // Rail layout settles on a later frame; what it does is part of opening.
    const opening = (borrowed.opening ?? 0) + 1;
    borrowed.opening = opening;
    const opened = borrowed;
    requestFrame?.(() => {
      if (borrowed === opened && opened.opening === opening)
        opened.applied = panelStates();
    });
    measureSheet();
    sheetFocusTarget(sheet)?.focus?.();
  };

  const tabFor = (sheet) =>
    [
      ...(element('mobile-tab-bar')?.querySelectorAll('[data-mobile-sheet]') ??
        []),
    ].find((button) => button.dataset.mobileSheet === sheet);

  const onMedia = (matches) => {
    if (matches) {
      body.classList.add(MOBILE_SHELL_CLASS);
      // Lets the page draw under the notch and system bars; the shell's CSS
      // keeps its chrome clear of them.
      if (viewport && !/viewport-fit\s*=/.test(viewportContent || ''))
        viewport.setAttribute(
          'content',
          `${viewportContent || ''}, viewport-fit=cover`,
        );
      for (const node of [...rails, dock].filter(Boolean))
        resize?.observe(node);
      publishChrome();
      measureSheet();
    } else {
      // Crossing to desktop closes the sheet, which puts its panels back.
      setSheet(null);
      body.classList.remove(MOBILE_SHELL_CLASS);
      present(null);
      resize?.disconnect();
      if (viewport && viewportContent !== null)
        viewport.setAttribute('content', viewportContent);
    }
  };

  const media =
    typeof matchMedia === 'function'
      ? matchMedia(MOBILE_SHELL_MEDIA_QUERY)
      : null;
  onMedia(Boolean(media?.matches));
  const onChange = (event) => onMedia(event.matches);
  if (media?.addEventListener) {
    media.addEventListener('change', onChange);
    removers.push(() => media.removeEventListener('change', onChange));
  } else if (media?.addListener) {
    // Safari before 14 only offers the legacy listener API.
    media.addListener(onChange);
    removers.push(() => media.removeListener(onChange));
  }

  listen(documentRef, 'click', (event) => {
    const target = event.target;
    if (target?.id === 'mobile-sheet-backdrop') {
      setSheet(null);
      return;
    }
    const button = target?.closest?.('[data-mobile-sheet]');
    if (!button || !element('mobile-tab-bar')?.contains(button)) return;
    event.preventDefault();
    const sheet = nextSheet(currentSheetOf(body), button.dataset.mobileSheet);
    // Closing from the tab bar returns focus to the tab that was pressed.
    if (!sheet) returnFocus = button;
    setSheet(sheet);
  });
  // Touch events let native scrolling continue until a downward pull at the
  // top is intentional. Pointer capture/touch-action:none would also seize
  // ordinary vertical scrolling inside the borrowed panels.
  const sheetRoot = (target, sheet) => {
    const roots =
      sheet === 'layers'
        ? [element('left-panel-stack')]
        : sheet === 'search'
          ? [dock]
          : sheet === 'more'
            ? // Visual lives in the left stack; the dock holds the presets.
              [element('left-panel-stack'), dock]
            : [element('right-context-rail')];
    return roots.find((root) => root?.contains(target));
  };
  const scrolled = (target, root) => {
    for (let node = target; node; node = node.parentElement) {
      if (node.scrollTop > 0) return true;
      if (node === root) break;
    }
    return false;
  };
  listen(
    documentRef,
    'touchstart',
    (event) => {
      swipe = null;
      const sheet = currentSheetOf(body);
      const target = event.target;
      if (
        !sheet ||
        !body.classList.contains(MOBILE_SHELL_CLASS) ||
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        target?.closest?.(
          'button, a, input, select, textarea, label, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="button"]',
        )
      )
        return;
      const root = sheetRoot(target, sheet);
      if (!root || scrolled(target, root)) return;
      const touch = event.touches[0];
      swipe = {
        sheet,
        target,
        root,
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        claimed: false,
      };
    },
    { passive: true },
  );
  listen(
    documentRef,
    'touchmove',
    (event) => {
      if (!swipe) return;
      const touch = event.touches[0];
      if (
        event.defaultPrevented ||
        event.touches.length !== 1 ||
        touch.identifier !== swipe.id ||
        currentSheetOf(body) !== swipe.sheet ||
        scrolled(swipe.target, swipe.root)
      ) {
        swipe = null;
        return;
      }
      const dx = touch.clientX - swipe.x;
      const dy = touch.clientY - swipe.y;
      if (!swipe.claimed) {
        // Claim direction before the browser crosses its native scroll slop.
        // Android can make the next move non-cancelable after a ~9px first move.
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 4) return;
        if (dy <= Math.abs(dx) * 1.25 || !event.cancelable) {
          swipe = null;
          return;
        }
        swipe.claimed = true;
      }
      // Cancelling only the claimed pull leaves taps, sliders and normal scroll
      // native, and suppresses the synthetic click at the end of a dismissal.
      event.preventDefault();
    },
    { passive: false },
  );
  listen(
    documentRef,
    'touchend',
    (event) => {
      const pull = swipe;
      swipe = null;
      if (!pull?.claimed || event.touches.length) return;
      const touch = [...event.changedTouches].find(
        (item) => item.identifier === pull.id,
      );
      if (!touch || currentSheetOf(body) !== pull.sheet) return;
      const dx = Math.abs(touch.clientX - pull.x);
      const dy = touch.clientY - pull.y;
      if (dy < 64 || dy <= dx * 1.25) return;
      returnFocus = tabFor(pull.sheet) ?? returnFocus;
      setSheet(null);
    },
    { passive: true },
  );
  listen(
    documentRef,
    'touchcancel',
    () => {
      swipe = null;
    },
    { passive: true },
  );
  // The grab handle: a tap steps peek → half → full, a vertical drag resizes
  // and a release rests at the nearest snap (a fling carries it on). The
  // handle captures the pointer, so a drag that starts on it never reaches the
  // globe, and a drag that starts on the globe never moves the sheet.
  const grabHandle = (target) =>
    target?.closest?.('#mobile-sheet-grab') ?? null;
  const viewportHeights = () =>
    snapHeights(globalThis.innerHeight || 0, {
      tabSpace:
        element('mobile-tab-bar')?.getBoundingClientRect?.().height || 58,
    });
  listen(documentRef, 'pointerdown', (event) => {
    const handle = grabHandle(event.target);
    const sheet = currentSheetOf(body);
    if (!handle || !resizable(sheet) || event.button > 0) return;
    handle.setPointerCapture?.(event.pointerId);
    grab = {
      id: event.pointerId,
      y: event.clientY,
      height: viewportHeights()[snap],
      claimed: false,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
  });
  listen(documentRef, 'pointermove', (event) => {
    if (!grab || event.pointerId !== grab.id) return;
    const dy = event.clientY - grab.y;
    if (!grab.claimed) {
      if (Math.abs(dy) < MOBILE_DRAG_CLAIM_PX) return;
      grab.claimed = true;
      body.classList.add('mobile-sheet-dragging');
    }
    event.preventDefault();
    const dt = Math.max(1, event.timeStamp - grab.lastT);
    grab.velocity = -(event.clientY - grab.lastY) / dt;
    grab.lastY = event.clientY;
    grab.lastT = event.timeStamp;
    const { full } = viewportHeights();
    // Past the ends the sheet follows at a third of the finger (rubber band).
    let height = grab.height - dy;
    if (height > full) height = full + (height - full) / 3;
    if (height < 0) height /= 3;
    body.style.setProperty(
      '--mobile-sheet-drag-height',
      `${Math.round(height)}px`,
    );
  });
  const releaseGrab = (event) => {
    if (!grab || event.pointerId !== grab.id) return;
    const drag = grab;
    endGrab();
    if (!drag.claimed) return;
    swallowGrabClick = true;
    setTimeout(() => {
      swallowGrabClick = false;
    }, 0);
    const height = drag.height - (event.clientY - drag.y);
    const rest = restingSnap(height, drag.velocity, viewportHeights());
    if (rest) setSnap(rest);
    else {
      returnFocus = tabFor(currentSheetOf(body)) ?? returnFocus;
      setSheet(null);
    }
  };
  listen(documentRef, 'pointerup', releaseGrab);
  listen(documentRef, 'pointercancel', (event) => {
    if (grab && event.pointerId === grab.id) endGrab();
  });
  listen(documentRef, 'click', (event) => {
    if (!grabHandle(event.target)) return;
    event.preventDefault();
    if (swallowGrabClick) return;
    setSnap(nextSnap(snap));
  });
  listen(documentRef, 'keydown', (event) => {
    if (!grabHandle(event.target)) return;
    const step = { ArrowUp: 1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const index = MOBILE_SHEET_SNAPS.indexOf(snap) + step;
    setSnap(
      MOBILE_SHEET_SNAPS[
        Math.max(0, Math.min(MOBILE_SHEET_SNAPS.length - 1, index))
      ],
    );
  });

  // Bubble phase, so fields cancelling an edit, lightboxes, viewers and tools
  // take Escape first; panels yield it to the sheet (PanelChrome), and an open
  // dialog keeps its own native close.
  listen(documentRef, 'keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    const sheet = currentSheetOf(body);
    if (!sheet || documentRef.querySelector('dialog[open]')) return;
    event.preventDefault();
    returnFocus = tabFor(sheet) ?? returnFocus;
    setSheet(null);
  });

  if (typeof MutationObserverImpl === 'function') {
    const observer = new MutationObserverImpl(() => {
      const sheet = currentSheetOf(body);
      if (!sheet) return;
      if (sheet === 'missions' && missionsPanel?.hidden) {
        returnFocus = tabFor('layers') ?? returnFocus;
        setSheet(null);
      } else if (sheetBlocked(body)) {
        setSheet(null);
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    if (missionsPanel)
      observer.observe(missionsPanel, {
        attributes: true,
        attributeFilter: ['hidden'],
      });
    removers.push(() => observer.disconnect());
  }

  return {
    setSheet,
    getSheet: () => currentSheetOf(body),
    setSnap,
    getSnap: () => (resizable(currentSheetOf(body)) ? snap : null),
    /**
     * The collapsed state to share for a panel a sheet borrowed: its state
     * before the sheets, or the user's own change since. Undefined otherwise.
     */
    sharedCollapsed(panelId) {
      if (!borrowed?.before.has(panelId)) return undefined;
      const now = prefersCollapsed(panelId);
      return now !== borrowed.applied.get(panelId)
        ? now
        : borrowed.before.get(panelId);
    },
    destroy() {
      setSheet(null);
      focusReturns += 1;
      for (const remove of removers.splice(0)) remove();
      body.classList.remove(MOBILE_SHELL_CLASS);
      body.removeAttribute(MOBILE_SHEET_ATTR);
      body.removeAttribute(MOBILE_SNAP_ATTR);
      body.style.removeProperty('--mobile-sheet-height');
      body.style.removeProperty('--mobile-sheet-cover');
      body.style.removeProperty('--mobile-dock-cover');
      if (viewport && viewportContent !== null)
        viewport.setAttribute('content', viewportContent);
      publish(null);
    },
  };
}
