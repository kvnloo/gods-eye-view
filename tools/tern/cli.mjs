#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { connect } from '@stencil-hq/tern';
import { createLocalRelay, localGlobeUrl } from './relay.mjs';
import { plainSummary } from './projection.mjs';
import { buildSurfaceView } from './view.mjs';

const PRESENTATION_TICK_MS = 5000;

export function parseArgs(argv) {
  const options = { appUrl: 'http://localhost:4173/', port: 0, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help') options.help = true;
    else if (argv[i] === '--app-url' && argv[i + 1]) options.appUrl = argv[++i];
    else if (argv[i] === '--port' && argv[i + 1]) {
      const value = argv[++i];
      if (!/^\d{1,5}$/.test(value)) throw new TypeError('Invalid --port');
      options.port = Number(value);
    } else throw new TypeError('Unexpected argument: ' + argv[i]);
  }
  if (!options.help) localGlobeUrl(options.appUrl);
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)
    throw new TypeError('Invalid relay port');
  return options;
}

const USAGE = [
  'GEV native Tern surface (local, opt-in, read-only)',
  'Usage: node tools/tern/cli.mjs [--app-url http://localhost:4173/] [--port 0]',
  'Start npm run dev first. Open the printed localhost link in that browser.',
  'Keys: r refresh, p pause presentation, h help, q/esc quit.',
].join('\n');

/**
 * Presentation adapter only. Injectable transports/clock exist for CLI
 * lifecycle tests; production always uses the official SDK and local relay.
 */
export async function run(argv = process.argv.slice(2), {
  connectSession = connect,
  makeRelay = createLocalRelay,
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  now = Date.now,
  startTicker = setInterval,
  stopTicker = clearInterval,
  observeSignals = true,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    stdout.write(USAGE + '\n');
    return;
  }

  // Unlike browserUrl, the fallback link never contains relay credentials.
  const publicGlobeUrl = localGlobeUrl(options.appUrl).href;
  const session = await connectSession({
    app: 'gods-eye-view', version: '0.2.1', exitHooks: false,
  });
  const native = session !== null &&
    session.caps.kinds.includes('col') &&
    session.caps.kinds.includes('text');
  if (!native && session) await session.close();

  let relay = null;
  let surface = null;
  let snapshot = null;
  let connected = false;
  let paused = false;
  let help = false;
  let notice = '';
  let stopped = false;
  let closing = null;
  let surfaceRecovery = 0;
  let input = null;
  let ticker = null;
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  const onSignal = () => void shutdown();

  function render() {
    if (stopped) return;
    if (!native) {
      stdout.write(plainSummary(snapshot, {
        connected, paused, notice, link: publicGlobeUrl, now: now(),
      }) + '\n\n');
      return;
    }
    if (surface?.closed) {
      if (++surfaceRecovery > 3) {
        notice = 'Native terminal surface unavailable';
        void shutdown();
        return;
      }
      surface = session.open({
        id: 'gev-context-recovery-' + surfaceRecovery,
        mode: 'inline',
        role: 'gev.context',
        title: "God's Eye View",
      });
    }
    surface.render(buildSurfaceView(snapshot, {
      connected,
      paused,
      help,
      notice,
      now: now(),
      onRefresh: refresh,
      onTogglePause: togglePause,
      onHelp: toggleHelp,
    }, session.caps));
  }

  function refresh() {
    if (stopped) return;
    const requested = relay?.requestSnapshot() === true;
    notice = requested ? 'Requested a new browser snapshot' : 'Browser not connected';
    render();
  }
  function togglePause() {
    if (stopped) return;
    paused = !paused;
    if (paused) {
      notice = 'Presentation paused (browser stays live)';
    } else {
      const requested = relay?.requestSnapshot() === true;
      notice = requested
        ? 'Presentation resumed; awaiting current browser snapshot'
        : 'Presentation resumed; browser not connected';
    }
    render();
  }
  function toggleHelp() {
    help = !help;
    render();
  }

  async function shutdown() {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      if (ticker !== null) {
        stopTicker(ticker);
        ticker = null;
      }
      if (observeSignals) for (const signal of signals) process.off(signal, onSignal);
      input?.close();
      try {
        await relay?.close();
      } finally {
        try {
          await surface?.close({ keep: false });
        } finally {
          await session?.close();
        }
      }
    })();
    return closing;
  }

  try {
    relay = await makeRelay({
      appUrl: options.appUrl,
      port: options.port,
      onSnapshot: (next) => {
        // Pause freezes what the operator sees; owner loss still invalidates it.
        if (stopped || paused) return;
        snapshot = next;
        notice = '';
        render();
      },
      onStatus: (status) => {
        if (stopped) return;
        connected = status === 'connected';
        // Both a disconnection and a new authenticated owner invalidate the
        // preceding generation, even if presentation was paused.
        snapshot = null;
        notice = connected
          ? 'Browser owner connected; awaiting its first snapshot'
          : 'Browser disconnected; reopen the private link if needed';
        render();
      },
    });

    if (native) {
      surface = session.open({
        id: 'gev-context',
        mode: 'inline',
        role: 'gev.context',
        title: "God's Eye View",
      });
    }
    if (observeSignals) for (const signal of signals) process.on(signal, onSignal);
    // Only this stderr line ever carries the ephemeral private attach URL.
    stderr.write('Open this local GEV browser link (keep private): ' + relay.browserUrl + '\n');
    render();
    ticker = startTicker(() => {
      // Age-only presentation redraw; no extra browser/subscription/feed work.
      if (!stopped && !paused && snapshot) render();
    }, PRESENTATION_TICK_MS);
    ticker?.unref?.();

    if (native) {
      for await (const message of session) {
        if (stopped) break;
        if (message.type === 'key') {
          const { name, ctrl } = message.key;
          if (name === 'q' || name === 'escape' || (name === 'c' && ctrl)) break;
          if (name === 'r') refresh();
          if (name === 'p') togglePause();
          if (name === 'h') toggleHelp();
        } else if (message.type === 'event') {
          if (['gone', 'resize', 'theme', 'motion'].includes(message.event.ev))
            render();
        }
      }
    } else {
      stdout.write('No Tern TSP session; using plain-text updates.\n');
      await new Promise((resolve) => {
        input = createInterface({ input: stdin, crlfDelay: Infinity });
        input.on('line', (line) => {
          switch (line.trim().toLowerCase()) {
            case 'q':
            case 'quit':
            case 'exit':
              resolve();
              break;
            case 'r':
              refresh();
              break;
            case 'p':
              togglePause();
              break;
            case 'h':
              stdout.write(USAGE + '\n');
              break;
          }
        });
        input.on('close', resolve);
      });
    }
  } finally {
    await shutdown();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((error) => {
    process.stderr.write('GEV Tern: ' + error.message + '\n');
    process.exitCode = 1;
  });
}
