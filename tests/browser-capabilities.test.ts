import { http, HttpResponse } from 'msw';
import { expect, it } from 'vitest';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import { checkDaemon, getBrowserCapabilities } from '@/shared/browser/messages';
import { supportsBrowserHandoff } from '@/shared/types/browser-capabilities';
import {
  browserCapabilities,
  capabilitiesUrl,
  health,
} from './fixtures/daemon';
import { connectTestBackground } from './render-page';
import { server } from './setup';

it('reads versioned capabilities through the trusted background', async () => {
  connectTestBackground();
  const result = await getBrowserCapabilities(defaultDaemonOrigin);
  expect(result).toEqual(browserCapabilities);
  expect(supportsBrowserHandoff(result)).toBe(true);
  expect(
    supportsBrowserHandoff({ ...browserCapabilities, protocol_version: 2 }),
  ).toBe(false);
  expect(
    supportsBrowserHandoff({ ...browserCapabilities, staged_handoff: false }),
  ).toBe(false);
});

it('keeps management available when an older daemon has no capability route', async () => {
  connectTestBackground();
  server.use(
    http.get(capabilitiesUrl, () => new HttpResponse(null, { status: 404 })),
  );
  const result = await getBrowserCapabilities(defaultDaemonOrigin);
  expect(result).toBeNull();
  expect(supportsBrowserHandoff(result)).toBe(false);
  await expect(checkDaemon(defaultDaemonOrigin)).resolves.toEqual(health);
});

it('distinguishes malformed capability responses from a missing endpoint', async () => {
  connectTestBackground();
  server.use(
    http.get(capabilitiesUrl, () => HttpResponse.json({ protocol_version: 1 })),
  );
  await expect(
    getBrowserCapabilities(defaultDaemonOrigin),
  ).rejects.toMatchObject({
    detail: { kind: 'invalid-response' },
  });
});
