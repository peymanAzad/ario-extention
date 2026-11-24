import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from '@webext-core/fake-browser';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { Confirmation } from '@/features/confirmation/confirmation';
import { defaultDaemonOrigin } from '@/shared/api/endpoint';
import { createBackgroundHandler } from '@/shared/browser/background';
import { createConfirmations } from '@/shared/browser/confirmations';
import { handoffLink } from '@/shared/types/confirmation';
import { defaultExtensionSettings } from '@/shared/types/settings';
import { capabilitiesUrl } from './fixtures/daemon';
import { liveDownload } from './fixtures/dashboard';
import { renderPage } from './render-page';
import { server } from './setup';

const menuItemId = 'ario-download-link';
const publicLink = 'https://files.example.test/capture.zip?key=fixture';
const pageUrl = 'https://files.example.test/list';
const magnet = `magnet:?xt=urn:btih:${'a'.repeat(40)}&dn=Test+torrent`;
const start = { queue_id: 1, finetune_override: null, start_immediately: true };
const handoffPath = `${defaultDaemonOrigin}/browser-handoffs`;

beforeEach(() => {
  vi.spyOn(fakeBrowser.windows, 'create');
});
afterEach(() => vi.unstubAllEnvs());

function daemonFixture() {
  const stages: unknown[] = [];
  const commits: string[] = [];
  const aborts: string[] = [];
  const state = new Map<string, 'staged' | 'committed' | 'aborted'>();
  const failures = {
    stageReply: false,
    commit: false,
    commitReply: false,
    commitRejected: false,
  };
  function receipt(id: string) {
    const current = state.get(id);
    return current
      ? HttpResponse.json({
          id,
          state: current,
          download_id: current === 'committed' ? 42 : null,
        })
      : new HttpResponse(null, { status: 404 });
  }
  server.use(
    http.post(handoffPath, async ({ request }) => {
      const body = (await request.json()) as { id: string; request: unknown };
      stages.push(body.request);
      if (!state.has(body.id)) state.set(body.id, 'staged');
      return failures.stageReply ? HttpResponse.error() : receipt(body.id);
    }),
    http.get(`${handoffPath}/:id`, ({ params }) => receipt(String(params.id))),
    http.post(`${handoffPath}/:id/commit`, ({ params }) => {
      const id = String(params.id);
      commits.push(id);
      if (failures.commit) return HttpResponse.error();
      if (failures.commitRejected)
        return HttpResponse.json(
          { result: 'error', message: 'Start is outside the queue schedule.' },
          { status: 409 },
        );
      if (state.get(id) === 'staged') state.set(id, 'committed');
      return failures.commitReply ? HttpResponse.error() : receipt(id);
    }),
    http.post(`${handoffPath}/:id/abort`, ({ params }) => {
      const id = String(params.id);
      aborts.push(id);
      if (state.get(id) === 'staged') state.set(id, 'aborted');
      return receipt(id);
    }),
  );
  return { stages, commits, aborts, state, failures };
}

type Manager = ReturnType<typeof createConfirmations>;

async function openDraft(
  manager: Manager,
  linkUrl = publicLink,
  source?: Browser.tabs.Tab,
  context?: Partial<Browser.contextMenus.OnClickData>,
) {
  await manager.open(
    { menuItemId, editable: false, linkUrl, pageUrl, frameId: 0, ...context },
    source,
  );
  return openedWindow();
}

async function openedWindow() {
  const popup = (await fakeBrowser.windows.getAll()).at(-1)!;
  const url = vi.mocked(fakeBrowser.windows.create).mock.lastCall?.[0]
    ?.url as string;
  const tab = await fakeBrowser.tabs.create({ windowId: popup.id, url });
  const hash = new URL(url).hash;
  const id = hash.slice(1);
  const sender = { id: fakeBrowser.runtime.id, frameId: 0, tab, url };
  return { popup, hash, id, sender };
}

function renderConfirmation(
  manager: Manager,
  draft: Awaited<ReturnType<typeof openDraft>>,
) {
  const handler = createBackgroundHandler(manager);
  vi.spyOn(fakeBrowser.runtime, 'sendMessage').mockImplementation(
    async (message: unknown) => handler(message, draft.sender),
  );
  return renderPage(<Confirmation hash={draft.hash} />);
}

it('adds media once through the ordinary URL API and preserves a signed URL', async () => {
  const url = 'https://files.example.test/clip.mp4?signature=x%2Fz%2B';
  const manager = createConfirmations();
  const writes: unknown[] = [];
  server.use(
    http.get(capabilitiesUrl, () => new HttpResponse(null, { status: 404 })),
    http.post(`${defaultDaemonOrigin}/downloads`, async ({ request }) => {
      writes.push(await request.json());
      return HttpResponse.json([liveDownload(42, { url })]);
    }),
  );
  await manager.openMedia(url);
  const draft = await openedWindow();
  const user = userEvent.setup();
  renderConfirmation(manager, draft);
  expect(await screen.findByText('clip.mp4')).toBeVisible();
  expect(screen.queryByText('Use browser session')).not.toBeInTheDocument();
  await user.selectOptions(await screen.findByLabelText('Queue'), '2');
  await user.click(screen.getByRole('button', { name: 'Save for later' }));
  expect(await screen.findByText('Added to Ario.')).toBeVisible();
  await manager.submit(draft.id, start, false, draft.sender);
  expect(writes).toEqual([
    {
      ...start,
      queue_id: 2,
      start_immediately: false,
      inputs: [{ Url: url }],
    },
  ]);
});

it('keeps a media submission locked after an uncertain response and background restart', async () => {
  const manager = createConfirmations();
  const add = vi.fn(() => HttpResponse.error());
  server.use(http.post(`${defaultDaemonOrigin}/downloads`, add));
  await manager.openMedia('https://files.example.test/movie.mp4');
  const { id, sender } = await openedWindow();
  await expect(manager.submit(id, start, false, sender)).resolves.toEqual({
    state: 'unknown',
  });
  const restarted = createConfirmations();
  await expect(restarted.get(id, sender)).resolves.toMatchObject({
    outcome: { state: 'unknown' },
  });
  await expect(restarted.submit(id, start, false, sender)).resolves.toEqual({
    state: 'unknown',
  });
  expect(add).toHaveBeenCalledTimes(1);
});

it('registers a link menu and always opens an opaque confirmation even with suppression enabled', async () => {
  const manager = createConfirmations();
  const createMenu = vi
    .spyOn(fakeBrowser.contextMenus, 'create')
    .mockReturnValue(menuItemId);
  const listen = vi
    .spyOn(fakeBrowser.contextMenus.onClicked, 'addListener')
    .mockImplementation(() => {});
  const fixture = daemonFixture();
  await fakeBrowser.storage.local.set({
    settings: {
      ...defaultExtensionSettings,
      capture: {
        ...defaultExtensionSettings.capture,
        askBeforeDownloading: false,
      },
    },
  });
  manager.register();
  await fakeBrowser.runtime.onInstalled.trigger({ reason: 'install' });
  expect(createMenu).toHaveBeenCalledWith({
    id: menuItemId,
    title: 'Download with Ario',
    contexts: ['link'],
  });
  listen.mock.calls[0]![0]({
    menuItemId,
    editable: false,
    linkUrl: publicLink,
  });
  await waitFor(async () =>
    expect(
      Object.keys(await fakeBrowser.storage.session.get(null)),
    ).toHaveLength(1),
  );
  const draft = await openedWindow();
  expect(draft.sender.url).toMatch(/\/confirmation\.html#[\da-f-]{36}$/);
  expect(draft.sender.url).not.toContain('fixture');
  expect(await manager.get(draft.id, draft.sender)).toMatchObject({
    url: publicLink,
    outcome: { state: 'draft' },
  });
  expect(fixture.stages).toHaveLength(0);
  await fakeBrowser.windows.remove(draft.popup.id!);
  await waitFor(async () =>
    expect(await fakeBrowser.storage.session.get(null)).toEqual({}),
  );
  expect(fixture.commits).toHaveLength(0);
});

it('saves the selected queue and per-file overrides through stage and commit', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  const draft = await openDraft(manager);
  renderConfirmation(manager, draft);
  const user = userEvent.setup();
  expect(await screen.findByText('capture.zip')).toBeVisible();
  expect(screen.getByText(publicLink)).toBeVisible();
  await user.selectOptions(await screen.findByLabelText('Queue'), '2');
  await user.selectOptions(
    screen.getByLabelText('Download settings'),
    'custom',
  );
  await user.type(screen.getByLabelText('Maximum retries'), '0');
  await user.click(screen.getByRole('button', { name: 'Save for later' }));
  expect(await screen.findByText('Added to Ario.')).toBeVisible();
  expect(fixture.stages).toEqual([
    expect.objectContaining({
      url: publicLink,
      method: 'GET',
      queue_id: 2,
      start_immediately: false,
      finetune_override: expect.objectContaining({ max_retries: 0 }),
    }),
  ]);
  expect(fixture.commits).toHaveLength(1);
  expect(await fakeBrowser.storage.local.get(null)).toEqual({});
});

it('isolates concurrent windows and coalesces repeated submissions and lost replies', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  fixture.failures.stageReply = true;
  fixture.failures.commitReply = true;
  const first = await openDraft(manager);
  const second = await openDraft(manager, magnet);
  const handler = createBackgroundHandler(manager);
  const message = {
    operation: 'confirmation.submit',
    id: first.id,
    options: start,
    session: false,
  };
  await expect(handler(message, second.sender)).resolves.toMatchObject({
    ok: false,
  });
  await expect(
    handler(message, { ...first.sender, tab: second.sender.tab }),
  ).resolves.toMatchObject({ ok: false });
  const replies = await Promise.all([
    handler(message, first.sender),
    handler(message, first.sender),
    handler({ ...message, id: second.id }, second.sender),
  ]);
  expect(replies).toEqual(
    Array(3).fill({ ok: true, data: { state: 'committed', downloadId: 42 } }),
  );
  expect(fixture.stages).toEqual(
    expect.arrayContaining([
      { ...start, url: publicLink, method: 'GET' },
      { ...start, url: magnet },
    ]),
  );
  expect(fixture.stages).toHaveLength(2);
  expect(new Set(fixture.commits).size).toBe(2);
  expect(fixture.commits).toHaveLength(2);
  await handler(message, first.sender);
  expect(fixture.stages).toHaveLength(2);
});

it('reconciles a staged submission after restart even when session storage is gone', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  fixture.failures.commit = true;
  const draft = await openDraft(manager);
  await expect(
    manager.submit(draft.id, start, false, draft.sender),
  ).resolves.toEqual({ state: 'pending' });
  const durable = await fakeBrowser.storage.local.get(null);
  expect(Object.values(durable)).toEqual([
    { id: fixture.commits[0], origin: defaultDaemonOrigin, phase: 'commit' },
  ]);
  await fakeBrowser.storage.session.clear();
  fixture.failures.commit = false;
  await createConfirmations().reconcile();
  expect(fixture.stages).toHaveLength(1);
  expect(fixture.commits).toEqual([fixture.commits[0], fixture.commits[0]]);
  expect([...fixture.state.values()]).toEqual(['committed']);
  expect(await fakeBrowser.storage.local.get(null)).toEqual({});
});

it('recovers active drafts across background suspension without staging them', async () => {
  const draft = await openDraft(createConfirmations());
  const fixture = daemonFixture();
  const restarted = createConfirmations();
  await restarted.reconcile();
  expect(await restarted.get(draft.id, draft.sender)).toMatchObject({
    url: publicLink,
    outcome: { state: 'draft' },
  });
  await fakeBrowser.windows.remove(draft.popup.id!);
  await restarted.reconcile();
  expect(await restarted.get(draft.id, draft.sender)).toBeNull();
  expect(fixture.stages).toHaveLength(0);
});

it('aborts a rejected commit and allows a new choice', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  fixture.failures.commitRejected = true;
  const draft = await openDraft(manager);
  await expect(
    manager.submit(draft.id, start, false, draft.sender),
  ).rejects.toThrow('Start is outside the queue schedule.');
  expect(fixture.aborts).toEqual(fixture.commits);
  fixture.failures.commitRejected = false;
  await expect(
    manager.submit(
      draft.id,
      { ...start, start_immediately: false },
      false,
      draft.sender,
    ),
  ).resolves.toMatchObject({ state: 'committed' });
  expect([...fixture.state.values()]).toEqual(['aborted', 'committed']);
});

it('offers public submission after the optional permission is denied', async () => {
  const manager = createConfirmations();
  const source = await fakeBrowser.tabs.create({ windowId: 0, url: pageUrl });
  const draft = await openDraft(manager, publicLink, source);
  const fixture = daemonFixture();
  const permission = vi
    .spyOn(fakeBrowser.permissions, 'request')
    .mockImplementation(async () => false);
  const cookieRead = vi.spyOn(fakeBrowser.cookies, 'getAll');
  vi.spyOn(window, 'close').mockImplementation(() => {});
  renderConfirmation(manager, draft);
  const user = userEvent.setup();
  const session = await screen.findByRole('checkbox', {
    name: 'Use browser session',
  });
  expect(session).not.toBeChecked();
  await user.click(session);
  expect(permission).toHaveBeenCalledWith({
    permissions: ['cookies'],
    origins: ['https://files.example.test/*'],
  });
  expect(await screen.findByText(/Cookie access was denied/)).toBeVisible();
  expect(session).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Back to browser' }));
  expect(window.close).toHaveBeenCalledOnce();
  expect(fixture.stages).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Start now' }));
  expect(await screen.findByText('Added to Ario.')).toBeVisible();
  expect(fixture.stages).toEqual([
    { ...start, url: publicLink, method: 'GET' },
  ]);
  expect(cookieRead).not.toHaveBeenCalled();
});

it.each(['Chrome', 'Firefox'])(
  'sends only URL-matched %s cookies from the source store and applicable partition',
  async (browserName) => {
    const firefox = browserName === 'Firefox';
    vi.stubEnv('FIREFOX', firefox ? 'true' : undefined);
    const manager = createConfirmations();
    const source = await fakeBrowser.tabs.create({ windowId: 0, url: pageUrl });
    const draft = await openDraft(manager, publicLink, source);
    const fixture = daemonFixture();
    vi.spyOn(fakeBrowser.permissions, 'contains').mockImplementation(
      async () => true,
    );
    vi.spyOn(fakeBrowser.cookies, 'getAllCookieStores').mockImplementation(
      async () => [
        { id: 'other', tabIds: [1234] },
        { id: 'source', tabIds: [source.id!] },
      ],
    );
    const partitionKey = {
      topLevelSite: 'https://example.test',
      hasCrossSiteAncestor: false,
    };
    const partition = vi
      .spyOn(fakeBrowser.cookies, 'getPartitionKey')
      .mockImplementation(async () => ({ partitionKey }));
    const baseCookie = {
      domain: 'files.example.test',
      hostOnly: true,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
      secure: true,
      session: true,
      storeId: 'source',
    } as const;
    const ordinary = { ...baseCookie, name: 'session', value: 'fixture' };
    const partitioned = [
      { ...baseCookie, name: 'partitioned', value: 'linked', partitionKey },
      {
        ...baseCookie,
        name: 'other',
        value: 'excluded',
        partitionKey: { topLevelSite: 'https://other.test' },
      },
      {
        ...baseCookie,
        name: 'embedded',
        value: 'excluded',
        partitionKey: { ...partitionKey, hasCrossSiteAncestor: true },
      },
    ];
    const read = vi
      .spyOn(fakeBrowser.cookies, 'getAll')
      .mockImplementation(async (details) =>
        details.partitionKey ? partitioned : [ordinary],
      );
    await expect(
      manager.submit(draft.id, start, true, draft.sender),
    ).resolves.toMatchObject({ state: 'committed' });
    if (firefox) expect(partition).not.toHaveBeenCalled();
    else
      expect(partition).toHaveBeenCalledWith({ tabId: source.id, frameId: 0 });
    expect(read).toHaveBeenCalledWith({ url: publicLink, storeId: 'source' });
    expect(read).toHaveBeenCalledWith({
      url: publicLink,
      storeId: 'source',
      partitionKey: firefox
        ? { ...partitionKey, topLevelSite: new URL(pageUrl).origin }
        : partitionKey,
    });
    expect(fixture.stages).toEqual([
      {
        ...start,
        url: publicLink,
        method: 'GET',
        session: { cookie: 'session=fixture; partitioned=linked' },
      },
    ]);
    expect(
      JSON.stringify(await fakeBrowser.storage.session.get(null)),
    ).not.toContain('session=fixture');
  },
);

it('rejects session use for frames, foreign origins, a changed tab, or removed access', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  const source = await fakeBrowser.tabs.create({ windowId: 0, url: pageUrl });
  const frame = await openDraft(manager, publicLink, source, { frameId: 3 });
  const foreign = await openDraft(
    manager,
    'https://elsewhere.test/download',
    source,
  );
  const changed = await openDraft(manager, publicLink, source);
  const permission = vi
    .spyOn(fakeBrowser.permissions, 'contains')
    .mockImplementation(async () => false);
  await expect(
    manager.submit(changed.id, start, true, changed.sender),
  ).rejects.toThrow('Cookie access was denied or removed');
  permission.mockImplementation(async () => true);
  await fakeBrowser.tabs.update(source.id!, {
    url: 'https://files.example.test/other',
  });
  await expect(
    manager.submit(changed.id, start, true, changed.sender),
  ).rejects.toThrow('page that opened this confirmation has changed');
  for (const draft of [frame, foreign]) {
    await expect(manager.get(draft.id, draft.sender)).resolves.toMatchObject({
      sessionHost: null,
    });
    await expect(
      manager.submit(draft.id, start, true, draft.sender),
    ).rejects.toThrow('browser session could not be identified');
  }
  expect(fixture.stages).toHaveLength(0);
});

it('offers retry for an unavailable daemon and upgrade guidance for an older daemon', async () => {
  const manager = createConfirmations();
  const fixture = daemonFixture();
  const draft = await openDraft(manager);
  server.use(http.get(capabilitiesUrl, () => HttpResponse.error()));
  renderConfirmation(manager, draft);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not reach the Ario daemon',
  );
  server.use(
    http.get(capabilitiesUrl, () => new HttpResponse(null, { status: 404 })),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/Upgrade the Ario daemon/)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Start now' }),
  ).not.toBeInTheDocument();
  await expect(
    manager.submit(draft.id, start, false, draft.sender),
  ).rejects.toThrow('Upgrade the Ario daemon');
  expect(fixture.stages).toHaveLength(0);
});

it('accepts the daemon’s public link schemes and removes URL fragments', () => {
  expect(handoffLink(`${publicLink}#section`)?.href).toBe(publicLink);
  expect(handoffLink(magnet)?.href).toBe(magnet);
  for (const link of [
    'https://@example.test/file',
    'https://user:password@example.test/file',
    'https:///example.test/file',
    'https://example.test:0/file',
    'file:///archive',
    'data:text/plain,no',
    'magnet:?xt=urn:btih:test',
  ]) {
    expect(handoffLink(link)).toBeNull();
  }
});
