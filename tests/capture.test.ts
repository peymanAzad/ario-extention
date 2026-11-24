import { fakeBrowser } from '@webext-core/fake-browser';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { defaultDaemonOrigin as origin } from '@/shared/api/endpoint';
import { createCapture } from '@/shared/browser/capture';
import {
  listCaptures,
  saveCapture,
  saveCaptureDraft,
} from '@/shared/browser/capture-storage';
import { capturePermissions } from '@/shared/browser/download-observation';
import { readSettings, updateSettings } from '@/shared/storage/settings';
import { fineTuneSchema } from '@/shared/types/daemon';
import type { ImportOptions } from '@/shared/types/download-workflows';
import { capabilitiesUrl } from './fixtures/daemon';
import { server } from './setup';

type Download = Browser.downloads.DownloadItem;
const site = 'https://files.example.test';
const handoffsPath = `${origin}/browser-handoffs`;
const start: ImportOptions = {
  queue_id: 1,
  finetune_override: null,
  start_immediately: true,
};
const filePath = '/tmp/Quarterly report.pdf';

function mockBrowser() {
  const items = new Map<number, Download>();
  const events: string[] = [];
  const granted = vi
    .spyOn(fakeBrowser.permissions, 'contains')
    .mockImplementation(async () => true);
  vi.spyOn(fakeBrowser.alarms, 'get').mockResolvedValue(undefined);
  vi.spyOn(fakeBrowser.alarms, 'create').mockImplementation(async () => {});
  const badge = vi
    .spyOn(fakeBrowser.action, 'setBadgeText')
    .mockResolvedValue();
  const erase = vi.spyOn(fakeBrowser.downloads, 'erase');
  vi.spyOn(fakeBrowser.downloads, 'search').mockImplementation(
    async ({ id }) => {
      const current = [...items.values()];
      return id === undefined
        ? current
        : current.filter((item) => item.id === id);
    },
  );
  const adjust = (id: number, patch: Partial<Download>) =>
    Object.assign(items.get(id)!, patch);
  const pause = vi
    .spyOn(fakeBrowser.downloads, 'pause')
    .mockImplementation(async (id) => {
      events.push(`pause:${id}`);
      adjust(id, {
        paused: true,
        canResume: true,
        ...(import.meta.env.FIREFOX && {
          state: 'interrupted',
          error: 'USER_CANCELED',
        }),
      });
    });
  const resume = vi
    .spyOn(fakeBrowser.downloads, 'resume')
    .mockImplementation(async (id) => {
      events.push(`resume:${id}`);
      adjust(id, {
        paused: false,
        canResume: false,
        state: 'in_progress',
        error: undefined,
      });
    });
  const cancel = vi
    .spyOn(fakeBrowser.downloads, 'cancel')
    .mockImplementation(async (id) => {
      events.push(`cancel:${id}`);
      adjust(id, {
        paused: !import.meta.env.FIREFOX,
        canResume: false,
        state: 'interrupted',
        error: 'USER_CANCELED',
      });
    });
  const listen = () => undefined;
  for (const event of [
    fakeBrowser.permissions.onAdded,
    fakeBrowser.permissions.onRemoved,
    fakeBrowser.runtime.onStartup,
    fakeBrowser.alarms.onAlarm,
  ])
    vi.spyOn(event, 'addListener').mockImplementation(listen);
  const begin = vi
    .spyOn(fakeBrowser.webRequest.onBeforeRequest, 'addListener')
    .mockImplementation(listen);
  const send = vi
    .spyOn(fakeBrowser.webRequest.onSendHeaders, 'addListener')
    .mockImplementation(listen);
  const receive = vi
    .spyOn(fakeBrowser.webRequest.onHeadersReceived, 'addListener')
    .mockImplementation(listen);
  const redirect = vi
    .spyOn(fakeBrowser.webRequest.onBeforeRedirect, 'addListener')
    .mockImplementation(listen);
  vi.spyOn(
    fakeBrowser.webRequest.onCompleted,
    'addListener',
  ).mockImplementation(listen);
  vi.spyOn(
    fakeBrowser.webRequest.onErrorOccurred,
    'addListener',
  ).mockImplementation(listen);
  const created = vi
    .spyOn(fakeBrowser.downloads.onCreated, 'addListener')
    .mockImplementation(listen);
  vi.spyOn(
    fakeBrowser.downloads.onCreated,
    'removeListener',
  ).mockImplementation(listen);
  for (const event of [
    fakeBrowser.webRequest.onBeforeRequest,
    fakeBrowser.webRequest.onSendHeaders,
    fakeBrowser.webRequest.onHeadersReceived,
    fakeBrowser.webRequest.onBeforeRedirect,
    fakeBrowser.webRequest.onCompleted,
    fakeBrowser.webRequest.onErrorOccurred,
  ])
    vi.spyOn(event, 'removeListener').mockImplementation(listen);
  const windows = vi.spyOn(fakeBrowser.windows, 'create');
  const manager = createCapture();
  function make(id = 1, patch: Partial<Download> = {}) {
    const url = `${site}/${id}.pdf`;
    const time = new Date(Date.now() - id * 2);
    const item: Download = {
      id,
      url,
      finalUrl: url,
      referrer: '',
      filename: filePath,
      incognito: false,
      danger: 'safe',
      mime: 'application/pdf',
      startTime: time.toISOString(),
      state: 'in_progress',
      paused: false,
      canResume: false,
      bytesReceived: 1000,
      totalBytes: 1500,
      fileSize: 1500,
      exists: false,
      ...patch,
    };
    items.set(id, item);
    return { ...item };
  }
  function observe(
    item: Download,
    {
      method = 'GET',
      headers = [],
      body = false,
      redirectTo,
      requestId = String(item.id),
    }: {
      method?: string;
      headers?: Browser.webRequest.HttpHeader[];
      body?: boolean;
      redirectTo?: string;
      requestId?: string;
    } = {},
  ) {
    const details = {
      requestId,
      method,
      timeStamp: Date.parse(item.startTime),
      url: item.url,
      tabId: 1,
      frameId: 0,
      parentFrameId: -1,
      type: 'main_frame' as const,
      documentLifecycle: 'active' as const,
      frameType: 'outermost_frame' as const,
    };
    begin.mock.lastCall![0]({
      ...details,
      ...(body && { requestBody: { raw: [] } }),
    });
    send.mock.lastCall![0]({
      ...details,
      requestHeaders: redirectTo ? [] : headers,
    });
    if (redirectTo) {
      redirect.mock.lastCall![0]({
        ...details,
        redirectUrl: redirectTo,
        statusCode: 302,
        statusLine: '302 Found',
        fromCache: false,
      });
      details.url = redirectTo;
      details.method = 'GET';
      begin.mock.lastCall![0](details);
      send.mock.lastCall![0]({ ...details, requestHeaders: headers });
    }
    receive.mock.lastCall![0]({
      ...details,
      statusCode: 200,
      statusLine: '200 OK',
    });
  }
  async function opened() {
    const url = windows.mock.lastCall![0]!.url as string;
    const id = new URL(url).hash.slice(1);
    const window = (await fakeBrowser.windows.getAll()).at(-1)!;
    const tab = await fakeBrowser.tabs.create({ windowId: window.id, url });
    return {
      id,
      sender: {
        id: fakeBrowser.runtime.id,
        url,
        tab,
      },
    };
  }
  return {
    adjust,
    badge,
    cancel,
    created,
    events,
    granted,
    items,
    manager,
    make,
    observe,
    opened,
    pause,
    resume,
    windows,
    erase,
  };
}

function mockDaemon(events: string[]) {
  type State = 'staged' | 'committed' | 'aborted';
  const states = new Map<string, State>();
  const calls = {
    stages: [] as Record<string, unknown>[],
    commits: [] as string[],
    aborts: [] as string[],
  };
  const behavior = {
    loseStage: false,
    loseCommit: false,
    offlineCommit: false,
    reject: false,
    offlineStatus: false,
  };
  const receipt = (id: string) => {
    const state = states.get(id);
    return state
      ? HttpResponse.json({
          id,
          state,
          download_id: state === 'committed' ? 42 : null,
        })
      : new HttpResponse(null, { status: 404 });
  };
  server.use(
    http.post(handoffsPath, async ({ request }) => {
      const { id, request: body } = (await request.json()) as {
        id: string;
        request: Record<string, unknown>;
      };
      calls.stages.push(body);
      events.push('stage');
      if (behavior.reject)
        return HttpResponse.json(
          { result: 'error', message: 'Queue unavailable.' },
          { status: 400 },
        );
      states.set(id, 'staged');
      return behavior.loseStage ? HttpResponse.error() : receipt(id);
    }),
    http.get(`${handoffsPath}/:id`, ({ params }) =>
      behavior.offlineStatus
        ? HttpResponse.error()
        : receipt(String(params.id)),
    ),
    http.post(`${handoffsPath}/:id/commit`, ({ params }) => {
      const id = String(params.id);
      calls.commits.push(id);
      events.push('commit');
      if (behavior.offlineCommit) return HttpResponse.error();
      states.set(id, 'committed');
      return behavior.loseCommit ? HttpResponse.error() : receipt(id);
    }),
    http.post(`${handoffsPath}/:id/abort`, ({ params }) => {
      const id = String(params.id);
      calls.aborts.push(id);
      if (states.has(id)) states.set(id, 'aborted');
      return receipt(id);
    }),
  );
  return { behavior, calls, states };
}

describe.each(['chrome', 'firefox'])('%s capture', (target) => {
  beforeEach(() =>
    vi.stubEnv('FIREFOX', target === 'firefox' ? 'true' : undefined),
  );
  afterEach(() => vi.unstubAllEnvs());

  it('stages while paused, cancels before commit, and preserves future defaults after suppression', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    b.manager.register();
    const item = b.make();
    b.observe(item);
    b.created.mock.lastCall![0](item);
    await b.manager.intercept(item);
    await vi.waitFor(() => expect(b.windows).toHaveBeenCalledTimes(1));
    const { id, sender } = await b.opened();
    expect((await b.manager.get(id, sender))?.capture).toMatchObject({
      options: start,
      fileName: 'Quarterly report.pdf',
    });
    expect(
      await b.manager.get(id, {
        ...sender,
        tab: { ...sender.tab, windowId: 99 },
      }),
    ).toBeNull();
    daemon.behavior.offlineCommit = true;
    expect(
      await b.manager.submit(
        id,
        { ...start, start_immediately: false },
        true,
        sender,
      ),
    ).toEqual({ state: 'pending' });
    expect(b.events).toEqual(['pause:1', 'stage', 'cancel:1', 'commit']);
    expect((await readSettings()).capture.askBeforeDownloading).toBe(true);
    const journal = await listCaptures();
    expect(journal[0]?.record.phase).toBe('commit');
    expect(JSON.stringify(journal)).not.toContain(item.url);
    daemon.behavior.offlineCommit = false;
    daemon.behavior.loseCommit = true;
    const restarted = createCapture();
    await restarted.reconcile();
    expect(await restarted.check(id, sender)).toEqual({
      state: 'committed',
      downloadId: 42,
    });
    expect(daemon.calls.commits[1]).toBe(daemon.calls.commits[0]);
    expect((await readSettings()).capture).toMatchObject({
      askBeforeDownloading: false,
      defaultQueueId: 1,
      startImmediately: true,
      fineTuneOverride: null,
    });
    expect(b.erase).not.toHaveBeenCalled();
    expect(await listCaptures()).toEqual([]);
  });

  it('uses configured automatic settings and passes observed cookies and the exact final signed URL', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    const override = fineTuneSchema.parse({ max_retries: 0 });
    await b.manager.savePreferences({
      askBeforeDownloading: false,
      defaultQueueId: 2,
      fineTuneOverride: override,
      startImmediately: false,
    });
    await b.manager.savePreferences({ useBrowserSession: true });
    const item = b.make(1, {
      finalUrl: target === 'chrome' ? `${site}/file?sig=x%2Fy%2B` : undefined,
    });
    const final = `${site}/file?sig=x%2Fy%2B`;
    b.observe(item, {
      redirectTo: final,
      headers: [
        { name: 'Cookie', value: 'fixture=applicable' },
        { name: 'Referer', value: `${site}/download-page` },
      ],
    });
    daemon.behavior.loseStage = true;
    await b.manager.intercept(item);
    expect(b.windows).not.toHaveBeenCalled();
    expect(daemon.calls.stages).toEqual([
      {
        ...start,
        queue_id: 2,
        finetune_override: override,
        start_immediately: false,
        url: final,
        method: 'GET',
        suggested_filename: 'Quarterly report.pdf',
        session: {
          cookie: 'fixture=applicable',
          referrer: `${site}/download-page`,
        },
      },
    ]);
    expect([...daemon.states.values()]).toEqual(['committed']);
    expect(
      JSON.stringify(await fakeBrowser.storage.local.get(null)),
    ).not.toContain('fixture=applicable');
    expect(
      JSON.stringify(await fakeBrowser.storage.session.get(null)),
    ).not.toContain('fixture=applicable');
  });

  it('asks when the configured queue is missing and restores the original on disable', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    await b.manager.savePreferences({
      askBeforeDownloading: false,
      defaultQueueId: 500,
    });
    const item = b.make();
    b.observe(item);
    await b.manager.intercept(item);
    const { id, sender } = await b.opened();
    expect((await b.manager.get(id, sender))?.capture).toMatchObject({
      automatic: true,
      options: { queue_id: 500 },
    });
    await b.manager.setEnabled(false);
    expect(await b.manager.get(id, sender)).toMatchObject({
      outcome: { state: 'browser' },
    });
    expect(b.resume).toHaveBeenCalledExactlyOnceWith(1);
    expect(daemon.calls.stages).toEqual([]);
  });

  it('aborts the stage and resumes after cancellation fails while retaining a recovery notice if resume fails', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    const item = b.make();
    b.observe(item);
    await b.manager.intercept(item);
    const { id, sender } = await b.opened();
    b.cancel.mockRejectedValueOnce(new Error('Cancel failed'));
    b.resume.mockRejectedValueOnce(new Error('Resume failed'));
    expect(await b.manager.submit(id, start, true, sender)).toEqual({
      state: 'recovery',
    });
    expect(daemon.calls.commits).toEqual([]);
    expect([...daemon.states.values()]).toEqual(['aborted']);
    expect(await b.manager.list()).toMatchObject([{ id, state: 'recovery' }]);
    expect((await readSettings()).capture.askBeforeDownloading).toBe(true);
    expect(await createCapture().retryBrowser(id)).toEqual({
      state: 'browser',
    });
    expect(await listCaptures()).toEqual([]);
  });

  it('leaves unsupported, ambiguous, credentialed, private, completed, dangerous and unpausable items in the browser', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    const files = [
      b.make(1),
      b.make(2),
      b.make(3, { url: 'blob:https://files.example.test/blob' }),
      b.make(4, { url: 'data:text/plain,download' }),
      b.make(5, { incognito: true }),
      b.make(6, { danger: 'uncommon' }),
      b.make(7, { state: 'complete' }),
      b.make(8),
      b.make(9),
      b.make(10),
      b.make(11),
      b.make(12),
    ];
    b.observe(files[0]!, { method: 'POST', redirectTo: files[0]?.url });
    b.observe(files[1]!, { body: true });
    b.observe(files[4]!);
    b.observe(files[5]!);
    b.observe(files[6]!);
    b.observe(files[7]!);
    b.observe(files[7]!, { requestId: 'conflicting-post', method: 'POST' });
    b.observe(files[8]!, {
      headers: [{ name: 'Cookie', value: 'auth=fixture' }],
    });
    b.observe(files[9]!, {
      headers: [{ name: 'Authorization', value: 'Basic fixture' }],
    });
    b.observe(files[10]!, { headers: [{ name: 'Range', value: 'bytes=0-9' }] });
    b.observe(files[11]!);
    b.pause.mockRejectedValueOnce(new Error('Pause failed'));
    await Promise.all(files.map((item) => b.manager.intercept(item)));
    expect(b.pause).toHaveBeenCalledExactlyOnceWith(12);
    expect(b.cancel).not.toHaveBeenCalled();
    expect(b.windows).not.toHaveBeenCalled();
    expect(daemon.calls.stages).toEqual([]);
    expect(await listCaptures()).toEqual([]);
  });

  it('recovers orphaned windows, denied permissions, and keeps independent concurrent downloads separate', async () => {
    const b = mockBrowser();
    mockDaemon(b.events);
    b.granted.mockImplementationOnce(async () => false);
    await b.manager.setEnabled(true);
    expect((await readSettings()).capture.enabled).toBe(true);
    expect(b.created).not.toHaveBeenCalled();
    await b.manager.setEnabled(true);
    b.windows
      .mockRejectedValueOnce(new Error('Can’t open window'))
      .mockRejectedValueOnce(new Error('Can’t open window'));
    const files = [b.make(1), b.make(2)];
    for (const item of files) b.observe(item);
    await Promise.all(files.map((item) => b.manager.intercept(item)));
    const [one, two] = await b.manager.list();
    expect(one?.state).toBe('confirmation');
    expect(two?.state).toBe('confirmation');
    await vi.waitFor(() => expect(b.badge).toHaveBeenCalledWith({ text: '2' }));
    await b.manager.reopen(one!.id);
    const { id, sender } = await b.opened();
    expect(await b.manager.get(id, sender)).toMatchObject({
      outcome: { state: 'draft' },
    });
    await fakeBrowser.windows.remove(sender.tab.windowId);
    await createCapture().reconcile();
    expect(b.resume).toHaveBeenCalledTimes(1);
    expect((await b.manager.list()).map(({ id }) => id)).toEqual([two!.id]);
    b.granted.mockImplementation(
      async (permissions) =>
        !permissions?.permissions?.includes(
          capturePermissions.permissions![1]!,
        ),
    );
    await b.manager.reconcile();
    expect(b.resume).toHaveBeenCalledTimes(2);
    expect(await b.manager.list()).toEqual([]);
    expect((await readSettings()).capture.enabled).toBe(true);
  });

  it('resumes during daemon outages and leaves a journal to abort an uncertain stage', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    const outage = b.make(1);
    b.observe(outage);
    server.use(http.get(capabilitiesUrl, () => HttpResponse.error()));
    await b.manager.intercept(outage);
    expect(b.events).toEqual(['pause:1', 'resume:1']);
    server.resetHandlers();
    const second = mockDaemon(b.events);
    second.behavior.loseStage = true;
    second.behavior.offlineStatus = true;
    const item = b.make(2);
    b.observe(item);
    await b.manager.intercept(item);
    const { id, sender } = await b.opened();
    // The first abort attempt is also unavailable.
    server.use(
      http.post(`${handoffsPath}/:id/abort`, () => HttpResponse.error(), {
        once: true,
      }),
    );
    expect(await b.manager.submit(id, start, false, sender)).toEqual({
      state: 'browser',
    });
    expect(b.resume).toHaveBeenCalledWith(2);
    expect(b.cancel).not.toHaveBeenCalled();
    expect(daemon.calls.commits).toEqual([]);
    expect((await listCaptures())[0]?.record.phase).toBe('fallback');
    second.behavior.offlineStatus = false;
    await createCapture().reconcile();
    expect([...second.states.values()]).toEqual(['aborted']);
    expect(second.calls.commits).toEqual([]);
    expect(await listCaptures()).toEqual([]);
  });

  it.each([
    'pausing',
    'awaiting',
    'staging',
    'canceling',
    'canceled',
    'commit',
  ] as const)('reconciles a restart at the %s boundary', async (boundary) => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    const needsHandoff = !['pausing', 'awaiting'].includes(boundary);
    const canceled = boundary === 'canceled' || boundary === 'commit';
    const item = b.make(8, {
      paused: !canceled,
      canResume: !canceled,
      state: canceled || target === 'firefox' ? 'interrupted' : 'in_progress',
      error: canceled || target === 'firefox' ? 'USER_CANCELED' : undefined,
    });
    const id = crypto.randomUUID();
    const handoffId = crypto.randomUUID();
    if (needsHandoff) daemon.states.set(handoffId, 'staged');
    const phase = boundary === 'canceled' ? 'canceling' : boundary;
    await saveCapture(id, {
      browserId: item.id,
      startedAt: item.startTime,
      origin,
      phase,
      handoffId,
      suppress: false,
    });
    await createCapture().reconcile();
    expect(await listCaptures()).toEqual([]);
    expect(b.events).toEqual(
      needsHandoff
        ? canceled
          ? ['commit']
          : ['cancel:8', 'commit']
        : ['resume:8'],
    );
  });

  it('does not suppress on a rejected explicit submission', async () => {
    const b = mockBrowser();
    const daemon = mockDaemon(b.events);
    await b.manager.setEnabled(true);
    const item = b.make();
    b.observe(item);
    await b.manager.intercept(item);
    const { id, sender } = await b.opened();
    daemon.behavior.reject = true;
    await expect(b.manager.submit(id, start, true, sender)).rejects.toThrow(
      'Queue unavailable',
    );
    expect((await readSettings()).capture.askBeforeDownloading).toBe(true);
    expect(await b.manager.check(id, sender)).toEqual({ state: 'draft' });
    expect(await b.manager.keep(id, sender)).toEqual({ state: 'browser' });
  });
});

it('restores an unsubmitted session-bearing draft when transient request context is lost', async () => {
  const b = mockBrowser();
  await updateSettings({ capture: { enabled: true, useBrowserSession: true } });
  const item = b.make(1, { paused: true, canResume: true });
  const id = crypto.randomUUID();
  await saveCapture(id, {
    browserId: item.id,
    startedAt: item.startTime,
    origin,
    phase: 'awaiting',
  });
  await saveCaptureDraft(id, {
    url: item.url,
    options: start,
    origin,
    session: true,
    automatic: false,
    outcome: { state: 'draft' },
  });
  await createCapture().reconcile();
  expect(b.resume).toHaveBeenCalledExactlyOnceWith(1);
});
