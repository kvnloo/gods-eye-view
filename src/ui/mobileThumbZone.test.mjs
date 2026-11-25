// The phone shell's thumb zone, ported from Sound Atlas: Cast as the sixth tab,
// sheets that rest at three heights, a grab handle that owns its drag, the
// globe actions within reach of the thumb, and Escape closing the innermost
// layer first.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp, nextTick } from 'vue';
import { createPinia } from 'pinia';
import {
  MOBILE_TABS,
  initMobileShell,
  nextSnap,
  restingSnap,
  snapHeights,
} from './mobileShell.js';
import { useDisplayStore } from './stores/display.js';
import { useCastStore } from './stores/cast.js';
import PhoneTabBar from './views/panels/PhoneTabBar.vue';
import CastMenu from './views/panels/CastMenu.vue';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./styles/mobile-shell.css').replace(/\s+/g, ' ');
/** The declaration block of the first rule whose selector list ends with `selector`. */
const rule = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `missing rule ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open, css.indexOf('}', open));
};

test('the tab bar has its sheets and Cast before More, one column each', () => {
  // Missions shows only while that layer is on (PhoneTabBar filters it).
  assert.deepEqual(
    MOBILE_TABS.map((tab) => tab.sheet ?? `action:${tab.action}`),
    ['layers', 'cameras', 'context', 'missions', 'search', 'action:cast', 'more'],
  );
  const bar = rule('body.mobile-shell #mobile-tab-bar');
  assert.match(bar, /grid-auto-flow: column;/);
  assert.match(bar, /grid-auto-columns: minmax\(0, 1fr\);/);
});

test('the viewport meta covers the notch and resizes for the keyboard without JS', () => {
  const meta = /<meta name="viewport" content="([^"]+)"/.exec(read('../../index.html'))[1];
  assert.match(meta, /viewport-fit=cover/);
  assert.match(meta, /interactive-widget=resizes-content/);
});

test('a tap on the handle steps peek → half → full → peek', () => {
  assert.equal(nextSnap('peek'), 'half');
  assert.equal(nextSnap('half'), 'full');
  assert.equal(nextSnap('full'), 'peek');
});

test('a released drag rests at the nearest height; a fling carries; a pull under peek closes', () => {
  const heights = snapHeights(844);
  assert.ok(heights.peek < heights.half && heights.half < heights.full);
  assert.equal(restingSnap(heights.half + 20, 0, heights), 'half');
  assert.equal(restingSnap(heights.half + 60, 0, heights), 'half');
  assert.equal(restingSnap(heights.half + 140, 0, heights), 'full');
  assert.equal(restingSnap(heights.full - 40, 0, heights), 'full');
  // A quick upward flick from half carries to full.
  assert.equal(restingSnap(heights.half + 40, 1.5, heights), 'full');
  assert.equal(restingSnap(heights.peek * 0.4, 0, heights), null);
});

function phone(t) {
  document.body.replaceChildren();
  document.body.innerHTML = `
    <div id="left-panel-stack"><section id="data-panel" class="collapsed"><button>Flights</button></section></div>
    <div id="right-context-rail"></div>
    <div id="command-dock"><div id="location-bar"><input id="location-search"></div></div>
    <canvas id="globe"></canvas>`;
  const pinia = createPinia();
  const app = createApp(PhoneTabBar).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  const display = useDisplayStore(pinia);
  const media = { matches: true, addEventListener() {}, removeEventListener() {} };
  const shell = initMobileShell({
    documentRef: document,
    matchMedia: () => media,
    ResizeObserverImpl: null,
    MutationObserverImpl: null,
    requestFrame: () => 0,
    setPanelCollapsed: (id, collapsed) =>
      document.getElementById(id)?.classList.toggle('collapsed', collapsed),
    publish: (view) => display.publishPhoneShell(view),
  });
  t.after(() => {
    shell.destroy();
    app.unmount();
  });
  return { shell, pinia };
}

const pointer = (type, target, y, id = 1) => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientY: y, button: 0 });
  target.dispatchEvent(event);
  return event;
};

test('a resizable sheet opens at half and the handle steps it, with a label that says so', async (t) => {
  const { shell } = phone(t);
  await nextTick();
  const tabs = [...document.querySelectorAll('#mobile-tab-bar > button')];
  assert.equal(tabs.length, 6);
  const cast = document.querySelector('#mobile-tab-bar [data-mobile-action="cast"]');
  // The name starts with the visible label (WCAG 2.5.3, axe label-content-name-mismatch).
  assert.equal(cast.getAttribute('aria-label'), 'Cast: play on a TV');
  assert.equal(cast.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(document.getElementById('mobile-sheet-grab'), null, 'no handle without a sheet');

  shell.setSheet('layers');
  await nextTick();
  assert.equal(document.body.getAttribute('data-mobile-snap'), 'half');
  const grab = document.getElementById('mobile-sheet-grab');
  assert.equal(grab.getAttribute('aria-label'), 'Resize sheet, now Half');
  grab.click();
  await nextTick();
  assert.equal(shell.getSnap(), 'full');
  assert.equal(document.getElementById('mobile-sheet-grab').getAttribute('aria-label'), 'Resize sheet, now Full');
  // Keyboard: the arrows step down and up.
  document.getElementById('mobile-sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  document.getElementById('mobile-sheet-grab').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(shell.getSnap(), 'peek');
  // Search is the dock alone: no heights, no handle.
  shell.setSheet('search');
  await nextTick();
  assert.equal(document.body.hasAttribute('data-mobile-snap'), false);
  assert.equal(document.getElementById('mobile-sheet-grab'), null);
  shell.setSheet(null);
  assert.equal(document.body.hasAttribute('data-mobile-snap'), false);
});

test('a drag on the handle resizes and rests at the nearest height; its click is swallowed', async (t) => {
  const { shell } = phone(t);
  shell.setSheet('layers');
  await nextTick();
  const grab = document.getElementById('mobile-sheet-grab');
  const heights = snapHeights(globalThis.innerHeight, { tabSpace: 58 });
  pointer('pointerdown', grab, 500);
  pointer('pointermove', grab, 496); // under the 8px claim: still a tap
  assert.equal(document.body.classList.contains('mobile-sheet-dragging'), false);
  const move = pointer('pointermove', grab, 500 - (heights.full - heights.half) + 10);
  assert.equal(move.defaultPrevented, true, 'a claimed drag keeps the page from scrolling');
  assert.equal(document.body.classList.contains('mobile-sheet-dragging'), true);
  assert.match(document.body.style.getPropertyValue('--mobile-sheet-drag-height'), /^\d+px$/);
  pointer('pointerup', grab, 500 - (heights.full - heights.half) + 10);
  grab.click(); // the click that ends a drag is not a tap
  assert.equal(shell.getSnap(), 'full');
  assert.equal(document.body.classList.contains('mobile-sheet-dragging'), false);
  assert.equal(document.body.style.getPropertyValue('--mobile-sheet-drag-height'), '');
});

test('a drag on the globe never moves the sheet', async (t) => {
  const { shell } = phone(t);
  shell.setSheet('layers');
  await nextTick();
  const globe = document.getElementById('globe');
  pointer('pointerdown', globe, 600);
  const move = pointer('pointermove', globe, 200);
  pointer('pointerup', globe, 200);
  assert.equal(move.defaultPrevented, false, 'the globe keeps its own gesture');
  assert.equal(shell.getSnap(), 'half');
  assert.equal(document.body.classList.contains('mobile-sheet-dragging'), false);
});

test('pulling the handle well under the peek closes the sheet', async (t) => {
  const { shell } = phone(t);
  shell.setSheet('layers');
  shell.setSnap('peek');
  await nextTick();
  const grab = document.getElementById('mobile-sheet-grab');
  pointer('pointerdown', grab, 600);
  pointer('pointermove', grab, 700);
  pointer('pointerup', grab, 840);
  assert.equal(shell.getSheet(), null);
});

test('Escape closes the cast menu before the sheet under it', async (t) => {
  const { shell, pinia } = phone(t);
  const menu = createApp(CastMenu).use(pinia);
  menu.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => menu.unmount());
  shell.setSheet('layers');
  const cast = useCastStore(pinia);
  cast.open();
  await nextTick();
  await nextTick();
  const dialog = document.getElementById('cast-menu');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-labelledby'), 'cast-menu-title');
  assert.deepEqual(
    [...dialog.querySelectorAll('[data-cast-target]')].map((b) => b.dataset.castTarget),
    ['samsung', 'chromecast', 'airplay'],
  );
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await nextTick();
  assert.equal(cast.menuOpen, false);
  assert.equal(shell.getSheet(), 'layers', 'the sheet stays for the next Escape');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(shell.getSheet(), null);
});

test('the globe actions sit in the thumb zone above the credits, at 44px', () => {
  const actions = rule('body.mobile-shell #top-center-actions');
  assert.match(actions, /top: auto;/);
  const lift = (block) =>
    Number(/bottom: calc\(var\(--mobile-tab-space\) \+ (\d+)px \+ var\(--world-timeline-lift, 0px\)\)/.exec(block)?.[1]);
  const credits = rule(
    'body.mobile-shell:not(.recording-mode):not(.cockpit-mode):not(.ui-clean-view) #cesium-credits',
  );
  assert.ok(lift(actions) >= lift(credits) + 36, 'clear of the two-line credit');
  const size = rule('body.mobile-shell #top-center-actions > #north-up-view');
  assert.match(size, /min-width: var\(--mobile-target\);/);
  assert.match(size, /min-height: var\(--mobile-target\);/);
  assert.match(css, /--mobile-target: 44px;/);
});

test('sheet heights follow the snap, snap instantly under reduced motion, and the handle owns touch', () => {
  assert.match(rule("body.mobile-shell[data-mobile-snap='peek']"), /var\(--mobile-snap-peek\)/);
  assert.match(rule("body.mobile-shell[data-mobile-snap='full']"), /var\(--mobile-snap-full\)/);
  assert.match(rule('body.mobile-shell[data-mobile-snap] #mobile-sheet-grab'), /touch-action: none;/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{ body\.mobile-shell\[data-mobile-snap\] #left-panel-stack, body\.mobile-shell\[data-mobile-snap\] #right-context-rail \{ transition: none;/,
  );
});
