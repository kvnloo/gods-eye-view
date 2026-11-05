#!/usr/bin/env node
/** Live Chromium contract for opt-in, same-origin Planet Playground local rooms. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const appUrl = process.env.QA_BASE_URL || 'http://localhost:4173';
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
if (!fs.existsSync(executablePath))
  throw new Error('Puppeteer Chromium executable is unavailable');

const browser = await puppeteer.launch({
  executablePath,
  headless: process.argv.includes('--headful') ? false : 'new',
  args: [
    '--no-sandbox',
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
  ],
});
const roomTab = '[role="tab"][data-mode="multiplayer"]';
const roomInput = '#planet-playground-content input[aria-label="Room code"]';

async function joinRoom(page, name) {
  await page.$eval(
    roomInput,
    (input, value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    name,
  );
  await page.evaluate(() => {
    const join = [...document.querySelectorAll('#planet-playground-content button')]
      .find((button) => button.textContent.trim() === 'Join local room');
    if (!join) throw new Error('Local-room Join control is missing');
    join.click();
  });
}

async function waitForPeers(page, count) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector('#planet-playground-content')?.lastElementChild
        ?.childElementCount === expected,
    { timeout: 10_000 },
    count,
  );
}

try {
  const first = await browser.newPage();
  const second = await browser.newPage();
  // Observe only channel lifecycle and received packet counts, never payloads.
  await first.evaluateOnNewDocument(() => {
    const NativeChannel = window.BroadcastChannel;
    if (typeof NativeChannel !== 'function')
      throw new Error('Chromium BroadcastChannel is unavailable');
    window.__qaRoomsOpened = 0;
    window.__qaRoomReceipts = 0;
    window.BroadcastChannel = class extends NativeChannel {
      constructor(name) {
        super(name);
        if (String(name).startsWith('gev-playground:')) {
          window.__qaRoomsOpened++;
          this.addEventListener('message', () => {
            window.__qaRoomReceipts++;
          });
        }
      }
    };
  });
  for (const page of [first, second]) {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('#planet-playground-launcher', {
      timeout: 60_000,
    });
  }
  await first.click('#planet-playground-launcher');
  await first.focus('[role="tab"][aria-selected="true"]');
  for (let index = 0; index < 3; index++) await first.keyboard.press('ArrowRight');
  assert.equal(
    await first.$eval(roomTab, (tab) => tab === document.activeElement),
    true,
    'arrow navigation should focus Local rooms',
  );
  assert.equal(await first.$eval(roomTab, (tab) => tab.getAttribute('aria-selected')),
    'false', 'focus-only navigation must not activate a room');
  assert.equal(await first.evaluate(() => window.__qaRoomsOpened), 0);
  await first.keyboard.press('Enter');
  await first.waitForSelector(roomInput);
  assert.equal(await first.$eval(roomTab, (tab) => tab.textContent), 'Local rooms');
  assert.match(
    await first.$eval('#planet-playground-content', (node) => node.textContent),
    /No internet rooms, verified identities/,
  );
  assert.equal(await first.evaluate(() => window.__qaRoomsOpened), 0);

  await second.click('#planet-playground-launcher');
  await second.click(roomTab);
  await second.waitForSelector(roomInput);
  await joinRoom(first, 'qa-alpha');
  await joinRoom(second, 'qa-beta');
  await waitForPeers(first, 0);
  await waitForPeers(second, 0);
  await joinRoom(second, 'qa-alpha');
  await waitForPeers(first, 1);
  await waitForPeers(second, 1);

  // A synthetic coarse packet exercises real DOM focus without real camera data.
  await second.evaluate(() => {
    window.__qaPeer = new BroadcastChannel('gev-playground:qa-alpha');
    window.__qaPeer.postMessage({
      protocol: 'gev.playground.local-room.v1',
      room: 'qa-alpha',
      peer: 'peer-browser-qa',
      kind: 'view',
      sentAt: Date.now(),
      view: { lat: 0, lon: 0, height: 10000 },
    });
  });
  await first.waitForFunction(
    () => [...document.querySelectorAll('#planet-playground-content button')]
      .some((button) => button.textContent === 'Visit view'),
    { timeout: 10_000 },
  );
  await first.evaluate(() => {
    window.__qaVisit = [...document.querySelectorAll('#planet-playground-content button')]
      .find((button) => button.textContent === 'Visit view');
    window.__qaVisit.focus();
  });
  const receivedBeforeHello = await first.evaluate(() => window.__qaRoomReceipts);
  await second.evaluate(() => {
    window.__qaPeer.postMessage({
      protocol: 'gev.playground.local-room.v1',
      room: 'qa-alpha',
      peer: 'peer-browser-qa',
      kind: 'hello',
      sentAt: Date.now(),
    });
  });
  await first.waitForFunction(
    (before) => window.__qaRoomReceipts > before,
    { timeout: 10_000 },
    receivedBeforeHello,
  );
  assert.equal(await first.evaluate(
    () => document.activeElement === window.__qaVisit,
  ), true, 'a peer heartbeat must not detach focused Visit view');
  await second.evaluate(() => {
    window.__qaPeer.postMessage({
      protocol: 'gev.playground.local-room.v1',
      room: 'qa-alpha',
      peer: 'peer-browser-qa',
      kind: 'leave',
      sentAt: Date.now(),
    });
    window.__qaPeer.close();
  });
  await first.waitForFunction(
    () => document.activeElement?.getAttribute('role') === 'status',
    { timeout: 10_000 },
  );
  await waitForPeers(first, 1);
  await waitForPeers(second, 1);

  await first.evaluate(() => {
    window.__qaRetainedJoin = [...document.querySelectorAll(
      '#planet-playground-content button',
    )].find((button) => button.textContent === 'Join local room');
  });
  await first.focus(roomInput);
  await first.keyboard.press('Escape');
  await first.waitForFunction(
    () => document.getElementById('planet-playground')?.hidden === true,
  );
  await waitForPeers(second, 0);
  const channelsBeforeStaleClick = await first.evaluate(
    () => window.__qaRoomsOpened,
  );
  await first.evaluate(() => window.__qaRetainedJoin.click());
  assert.equal(await first.evaluate(() => window.__qaRoomsOpened),
    channelsBeforeStaleClick, 'stale hidden Join must not reopen a room');
  console.log('PASS: Chromium keyboard, focus, independent rooms and teardown');
} finally {
  await browser.close();
}
