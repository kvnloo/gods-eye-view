import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

/** Portable outbound ntfy transport; credentials never enter URLs or public state. */
export function createNtfyNotifier({
  server,
  topic,
  token,
  fetchImpl = globalThis.fetch,
}) {
  const endpoint = new URL(server);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
      !(
        endpoint.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname)
      )) ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(topic)
  )
    throw new TypeError('Use an HTTPS ntfy server and a valid topic');
  return {
    async send({ title, message, url, signal }) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            topic,
            title,
            message,
            click: url,
            tags: ['globe_with_meridians'],
          }),
        });
      } catch (error) {
        // These failures occur before a TCP connection/request exists. Resets,
        // aborts and response timeouts can follow delivery and remain uncertain.
        const beforeConnect = [
          'ENOTFOUND',
          'EAI_AGAIN',
          'ECONNREFUSED',
          'ENETUNREACH',
          'EHOSTUNREACH',
          'UND_ERR_CONNECT_TIMEOUT',
        ];
        if (beforeConnect.includes(error?.cause?.code))
          throw Object.assign(new Error('Notification server unreachable'), {
            retryable: true,
          });
        throw new Error('Notification delivery outcome unknown');
      }
      await response.body?.cancel();
      if (!response.ok)
        throw Object.assign(
          new Error('Notification server rejected delivery'),
          { retryable: response.status === 429 || response.status >= 500 },
        );
    },
  };
}

/** Local opt-in KDE Connect target; no discovery, pairing or automatic device selection. */
export function createKdeConnectNotifier({ deviceId, execFileImpl = run }) {
  if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(deviceId))
    throw new TypeError('An explicit paired KDE Connect device ID is required');
  return {
    async send({ title, message, signal }) {
      try {
        await execFileImpl(
          'kdeconnect-cli',
          ['--device', deviceId, '--ping-msg', `${title}\n${message}`],
          { timeout: 15000, signal, maxBuffer: 4096 },
        );
      } catch {
        throw new Error('Paired notification delivery outcome unknown');
      }
    },
  };
}
