import { browser, type Browser } from 'wxt/browser';
import { readSettings, watchSettings } from '@/shared/storage/settings';
import { ArioError } from '@/shared/types/connection';
import {
  isDirectMedia,
  mediaLimit,
  mediaPageMessageSchema,
  mediaUrl,
  type DetectedMedia,
  type MediaSource,
} from '@/shared/types/media';

const storagePrefix = 'arioMedia:';
const storageKey = (tabId: number) => `${storagePrefix}${tabId}`;
const observationLimit = 32;
const requestLimit = 256;
type Frame = { id: number; document: string; sources: DetectedMedia[] };
type Observation = {
  frameId: number;
  url: string;
  finalUrl: string;
  type: string;
};
type TabMedia = { frames: Frame[]; responses: Observation[] };
type RequestSource = { tabId: number; frameId: number; url: string };

async function readTab(tabId: number): Promise<TabMedia> {
  const key = storageKey(tabId);
  const values =
    await browser.storage.session.get<Record<string, TabMedia>>(key);
  return values[key] ?? { frames: [], responses: [] };
}

function eligible(frame: Frame, responses: Observation[]) {
  return frame.sources.filter(({ url }) => {
    const response = responses.find(
      (entry) => entry.frameId === frame.id && entry.url === url,
    );
    return isDirectMedia(url, response?.type, response?.finalUrl);
  });
}

const unavailable = () =>
  new ArioError({
    kind: 'extension',
    message: 'This media is no longer available on the page.',
  });

export function createMedia(openConfirmation: (url: string) => Promise<void>) {
  let enabled = false;
  let ready: Promise<void> | undefined;
  let writes = Promise.resolve();
  const requests = new Map<string, RequestSource>();

  function write<T>(operation: () => Promise<T>) {
    const result = writes.then(operation);
    writes = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function activeTabId() {
    const [tab] = await browser.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tab?.url && !tab.incognito && !tab.pendingUrl && mediaUrl(tab.url)
      ? tab.id
      : undefined;
  }

  async function live(frame: Frame, tabId: number, url?: string) {
    return browser.tabs
      .sendMessage(
        tabId,
        {
          operation: 'media.verify',
          document: frame.document,
          url,
        },
        { frameId: frame.id },
      )
      .then(
        (verified) => verified === true,
        () => false,
      );
  }

  async function list(): Promise<DetectedMedia[]> {
    if (!(await readSettings()).detectMedia) return [];
    const tabId = await activeTabId();
    if (tabId === undefined) return [];
    const { frames, responses } = await readTab(tabId);
    const entries = await Promise.all(
      frames.map(async (frame) => {
        const candidates = eligible(frame, responses);
        return candidates.length && (await live(frame, tabId))
          ? candidates
          : [];
      }),
    );
    if (tabId !== (await activeTabId()) || !(await readSettings()).detectMedia)
      return [];
    return [
      ...new Map(entries.flat().map((media) => [media.url, media])).values(),
    ];
  }

  async function open(
    tabId: number,
    id: string,
    owner?: { frameId: number; document: string },
  ) {
    if (!(await readSettings()).detectMedia) throw unavailable();
    const { frames, responses } = await readTab(tabId);
    const frame = frames.find(
      (entry) =>
        (!owner ||
          (entry.id === owner.frameId && entry.document === owner.document)) &&
        entry.sources.some((source) => source.id === id),
    );
    const candidate =
      frame && eligible(frame, responses).find((item) => item.id === id);
    if (!frame || !candidate || !(await live(frame, tabId, candidate.url)))
      throw unavailable();
    if (
      !(await readSettings()).detectMedia ||
      (!owner && tabId !== (await activeTabId()))
    )
      throw unavailable();
    await openConfirmation(candidate.url);
  }

  async function openFromPopup(id: string) {
    const tabId = await activeTabId();
    if (tabId === undefined) throw unavailable();
    await open(tabId, id);
  }

  function report(
    tabId: number,
    frameId: number,
    document: string,
    sources: MediaSource[],
  ) {
    return write(async () => {
      if (!(await readSettings()).detectMedia) return [];
      const state = await readTab(tabId);
      const previous = state.frames.find((frame) => frame.id === frameId);
      const previousSources =
        previous?.document === document ? previous.sources : [];
      if (!sources.length && !previousSources.length) return [];
      const unique = new Map(sources.map((source) => [source.url, source]));
      const detected = [...unique.values()].map((source) => ({
        ...source,
        id:
          previousSources.find(({ url }) => url === source.url)?.id ??
          crypto.randomUUID(),
      }));
      const frame = { id: frameId, document, sources: detected };
      if (JSON.stringify(detected) !== JSON.stringify(previousSources)) {
        const others = state.frames.filter((item) => item.id !== frameId);
        let remaining = mediaLimit - detected.length;
        state.frames = (detected.length ? [frame] : []).concat(
          others.flatMap((entry) => {
            const kept = entry.sources.slice(0, remaining);
            remaining -= kept.length;
            return kept.length ? [{ ...entry, sources: kept }] : [];
          }),
        );
        await browser.storage.session.set({ [storageKey(tabId)]: state });
      }
      return eligible(frame, state.responses);
    });
  }

  function onPageMessage(
    message: unknown,
    sender: Browser.runtime.MessageSender,
  ) {
    const parsed = mediaPageMessageSchema.safeParse(message);
    const tabId = sender.tab?.id;
    const frameId = sender.frameId;
    if (
      !parsed.success ||
      sender.id !== browser.runtime.id ||
      tabId === undefined ||
      frameId === undefined ||
      frameId < 0 ||
      sender.tab?.incognito ||
      !sender.url ||
      !mediaUrl(sender.url) ||
      !sender.tab?.url ||
      !mediaUrl(sender.tab.url)
    )
      return undefined;

    const data = parsed.data;
    const reply =
      data.operation === 'media.report'
        ? report(tabId, frameId, data.document, data.sources)
        : open(tabId, data.id, { frameId, document: data.document });
    return reply.then(
      (value) => ({ ok: true as const, data: value ?? null }),
      (error: unknown) => ({
        ok: false as const,
        error:
          error instanceof ArioError
            ? error.detail
            : {
                kind: 'extension' as const,
                message: 'Ario could not open detected media.',
              },
      }),
    );
  }

  function forgetTab(tabId: number) {
    for (const [id, request] of requests) {
      if (request.tabId === tabId) requests.delete(id);
    }
    void write(() => browser.storage.session.remove(storageKey(tabId))).catch(
      () => {},
    );
  }

  function refreshFrame(tabId: number, frameId: number) {
    void browser.tabs
      .sendMessage(tabId, { operation: 'media.refresh' }, { frameId })
      .catch(() => {});
  }

  function register() {
    function setEnabled(value: boolean) {
      enabled = value;
      if (value) return;
      requests.clear();
      void write(async () => {
        const current = await browser.storage.session.get(null);
        await browser.storage.session.remove(
          Object.keys(current).filter((key) => key.startsWith(storagePrefix)),
        );
      }).catch(() => {});
    }
    ready = readSettings().then(
      ({ detectMedia }) => setEnabled(detectMedia),
      () => setEnabled(false),
    );
    watchSettings(({ detectMedia }) => {
      if (detectMedia !== enabled) setEnabled(detectMedia);
    });
    function observe(operation: () => void) {
      if (enabled) operation();
      else if (ready)
        void ready.then(() => {
          if (enabled) operation();
        });
    }
    void ready.then(() => {
      ready = undefined;
    });

    browser.tabs.onRemoved.addListener((tabId) =>
      observe(() => forgetTab(tabId)),
    );
    browser.tabs.onUpdated.addListener((tabId, change) => {
      observe(() => {
        if (change.status === 'loading' || change.url) forgetTab(tabId);
        if (change.status === 'complete' || (change.url && !change.status))
          refreshFrame(tabId, 0);
      });
    });

    const filter: Browser.webRequest.RequestFilter = {
      urls: ['http://*/*', 'https://*/*'],
      types: ['media'],
    };
    browser.webRequest.onBeforeRequest.addListener((details) => {
      observe(() => {
        if (
          requests.has(details.requestId) ||
          details.tabId < 0 ||
          details.frameId < 0 ||
          details.method !== 'GET'
        )
          return;
        const url = mediaUrl(details.url);
        if (!url) return;
        if (requests.size >= requestLimit) {
          const first = requests.keys().next().value;
          if (first !== undefined) requests.delete(first);
        }
        requests.set(details.requestId, {
          tabId: details.tabId,
          frameId: details.frameId,
          url,
        });
      });
      return undefined;
    }, filter);

    browser.webRequest.onHeadersReceived.addListener(
      (details) => {
        observe(() => {
          const request = requests.get(details.requestId);
          if (
            !request ||
            (details.statusCode !== 200 && details.statusCode !== 206)
          )
            return;
          const finalUrl = mediaUrl(details.url);
          const type = details.responseHeaders
            ?.find(({ name }) => name.toLowerCase() === 'content-type')
            ?.value?.split(';', 1)[0]
            ?.trim()
            .toLowerCase();
          if (!finalUrl || !type || type.length > 128) return;
          const { tabId, frameId, url } = request;
          void write(async () => {
            if (!enabled) return;
            const state = await readTab(tabId);
            const responses = state.responses.filter(
              (entry) => entry.frameId !== frameId || entry.url !== url,
            );
            const old = state.responses.find(
              (entry) => entry.frameId === frameId && entry.url === url,
            );
            if (old?.type === type && old.finalUrl === finalUrl) return;
            state.responses = [
              { frameId, url, finalUrl, type },
              ...responses,
            ].slice(0, observationLimit);
            await browser.storage.session.set({ [storageKey(tabId)]: state });
            refreshFrame(tabId, frameId);
          }).catch(() => {});
        });
        return undefined;
      },
      filter,
      ['responseHeaders'],
    );

    const finish = ({ requestId }: { requestId: string }) =>
      observe(() => {
        requests.delete(requestId);
      });
    browser.webRequest.onCompleted.addListener(finish, filter);
    browser.webRequest.onErrorOccurred.addListener(finish, filter);
  }

  return { register, onPageMessage, list, openFromPopup };
}
