import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from '@webext-core/fake-browser';
import { defaultDaemonOrigin, parseDaemonOrigin } from '@/shared/api/endpoint';
import { requestDaemon } from '@/shared/api/transport';
import {
  createBackgroundHandler,
  isTrustedUi,
} from '@/shared/browser/background';
import { daemonSettingsSchema, healthSchema } from '@/shared/types/daemon';
import {
  aria2Offline,
  daemonOffline,
  health,
  healthUrl,
} from './fixtures/daemon';
import { server } from './setup';

describe('loopback HTTP validation', () => {
  it.each([
    [' http://LOCALHOST:09999/ ', 'http://localhost:9999'],
    ['http://[::1]:47813', 'http://[::1]:47813'],
    ['http://127.0.0.1:80', 'http://127.0.0.1'],
    ['http://127.0.0.1:65535', 'http://127.0.0.1:65535'],
  ])('normalizes %s', (input, expected) => {
    expect(parseDaemonOrigin(input)).toBe(expected);
  });

  it.each([
    'https://localhost:47812',
    'http://192.168.0.1:47812',
    'http://localhost.example.test',
    'http://localhost@192.168.0.1',
    'http://user:password@127.0.0.1',
    'http://localhost/health',
    'http://localhost?query=1',
    'http://[::1]#hash',
    'http://localhost:0',
    'http://localhost:65536',
    'http://localhost:-1',
    'http://0x7f000001',
    'http://127.0.0.1\\@example.test',
  ])('rejects %s', (input) => {
    expect(parseDaemonOrigin(input)).toBeNull();
  });
});

const readHealth = () =>
  requestDaemon(defaultDaemonOrigin, '/health', healthSchema);

describe('daemon transport', () => {
  it('reads bare health JSON, including a distinct aria2 outage', async () => {
    await expect(readHealth()).resolves.toEqual(health);
    server.use(aria2Offline);
    await expect(readHealth()).resolves.toMatchObject({
      aria2_reachable: false,
    });
  });

  it('discards proxy credentials while decoding daemon settings', async () => {
    const settings = await requestDaemon(
      defaultDaemonOrigin,
      '/settings',
      daemonSettingsSchema,
    );
    expect(settings.proxy).toEqual({
      enabled: true,
      host: '127.0.0.1',
      port: 8080,
    });
  });

  it('classifies a refused connection', async () => {
    server.use(daemonOffline);
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'unavailable' },
    });
  });

  it('times out a pending request and accepts caller cancellation', async () => {
    server.use(
      http.get(healthUrl, async () => {
        await delay(100);
        return HttpResponse.json(health);
      }),
    );

    await expect(
      requestDaemon(defaultDaemonOrigin, '/health', healthSchema, {
        timeoutMs: 10,
      }),
    ).rejects.toMatchObject({ detail: { kind: 'timeout' } });

    const controller = new AbortController();
    const request = requestDaemon(
      defaultDaemonOrigin,
      '/health',
      healthSchema,
      {
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(request).rejects.toMatchObject({
      detail: { kind: 'cancelled' },
    });
  });

  it('distinguishes empty successes, structured errors, and malformed JSON responses', async () => {
    const endpoint = `${defaultDaemonOrigin}/queues/1/pause`;
    server.use(
      http.post(endpoint, () => new HttpResponse(null, { status: 200 })),
    );
    await expect(
      requestDaemon(defaultDaemonOrigin, '/queues/1/pause', 'empty', {
        method: 'POST',
      }),
    ).resolves.toBeUndefined();

    server.use(
      http.get(healthUrl, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'invalid-response' },
    });

    server.use(
      http.get(healthUrl, () =>
        HttpResponse.json(
          { result: 'error', message: 'Database locked' },
          { status: 500 },
        ),
      ),
    );
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'http', status: 500, message: 'Database locked' },
    });

    server.use(http.get(healthUrl, () => HttpResponse.text('not JSON')));
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'invalid-response' },
    });

    server.use(
      http.get(healthUrl, () =>
        HttpResponse.json({ ...health, aria2_reachable: 'yes' }),
      ),
    );
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'invalid-response' },
    });
  });

  it('rejects addresses before fetching and refuses redirects', async () => {
    const target = 'http://example.test/health';
    const redirected = vi.fn(() => HttpResponse.json(health));
    server.use(
      http.get(healthUrl, () => HttpResponse.redirect(target)),
      http.get(target, redirected),
    );
    await expect(
      requestDaemon('http://example.test', '/health', healthSchema),
    ).rejects.toMatchObject({ detail: { kind: 'invalid-address' } });
    await expect(readHealth()).rejects.toMatchObject({
      detail: { kind: 'unavailable' },
    });
    expect(redirected).not.toHaveBeenCalled();
  });
});

describe('background message boundary', () => {
  const trusted = () => ({
    id: fakeBrowser.runtime.id,
    url: fakeBrowser.runtime.getURL('/options.html'),
    frameId: 0,
  });

  it('accepts only named messages from its own top-level extension pages', async () => {
    const handler = createBackgroundHandler();
    const sender = trusted();
    const message = {
      operation: 'daemon.health',
      origin: defaultDaemonOrigin,
      requestId: crypto.randomUUID(),
    };

    expect(
      isTrustedUi({ ...sender, url: `${sender.url}?tab=connection#test` }),
    ).toBe(true);
    expect(
      handler(message, { ...sender, id: 'external-extension' }),
    ).toBeUndefined();
    expect(
      handler(message, { ...sender, url: 'https://example.test/options.html' }),
    ).toBeUndefined();
    expect(
      handler(message, { ...sender, url: sender.url + '.bak' }),
    ).toBeUndefined();
    expect(handler(message, { ...sender, frameId: 1 })).toBeUndefined();
    expect(
      handler({ operation: 'fetch', url: healthUrl }, sender),
    ).toBeUndefined();
    expect(handler({ ...message, path: '/shutdown' }, sender)).toBeUndefined();
    await expect(
      handler({ ...message, origin: 'http://example.test' }, sender),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'invalid-address' },
    });
    await expect(handler(message, sender)).resolves.toMatchObject({
      ok: true,
      data: health,
    });
  });

  it('cancels a named request only from its initiating extension document', async () => {
    server.use(
      http.get(healthUrl, async () => {
        await delay(100);
        return HttpResponse.json(health);
      }),
    );
    const handler = createBackgroundHandler();
    const sender = { ...trusted(), documentId: 'initiator' };
    const requestId = crypto.randomUUID();
    const request = handler(
      { operation: 'daemon.health', origin: defaultDaemonOrigin, requestId },
      sender,
    );
    await handler(
      { operation: 'daemon.cancel', requestId },
      { ...sender, documentId: 'different' },
    );
    await expect(request).resolves.toMatchObject({ ok: true });

    const next = handler(
      { operation: 'daemon.health', origin: defaultDaemonOrigin, requestId },
      sender,
    );
    await handler({ operation: 'daemon.cancel', requestId }, sender);
    await expect(next).resolves.toMatchObject({
      ok: false,
      error: { kind: 'cancelled' },
    });
  });
});
