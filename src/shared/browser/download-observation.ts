import { browser, type Browser } from 'wxt/browser';
import type { HandoffSession } from '@/shared/api/browser-handoffs';
import { handoffLink } from '@/shared/types/confirmation';

export const capturePermissions: Browser.permissions.Permissions = {
  permissions: ['downloads', 'webRequest'],
  origins: ['http://*/*', 'https://*/*'],
};

type Item = Browser.downloads.DownloadItem;
type Header = Browser.webRequest.HttpHeader;
type Observation = {
  first: string;
  current: string;
  next?: string;
  started: number;
  updated: number;
  received?: number;
  rejected: boolean;
  sent: boolean;
  claimed: boolean;
  session?: HandoffSession;
};

const observationLifetime = 30_000;
const matchWindow = 1_500;
const maximumObservations = 512;
const ordinaryHeaders = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'cache-control',
  'connection',
  'dnt',
  'host',
  'pragma',
  'priority',
  'te',
  'upgrade-insecure-requests',
]);

function httpLink(raw: string) {
  const url = handoffLink(raw);
  return url && (url.protocol === 'http:' || url.protocol === 'https:')
    ? url.href
    : undefined;
}

function requestSession(headers: Header[]): HandoffSession | false {
  const session: HandoffSession = {};
  for (const { name, value } of headers) {
    const key = name.toLowerCase();
    if (ordinaryHeaders.has(key) || key.startsWith('sec-')) continue;
    if (key === 'content-length' && value === '0') continue;
    if (
      !value ||
      value.length > 8192 ||
      value.trim() !== value ||
      !/^[ -~]+$/.test(value)
    )
      return false;
    switch (key) {
      case 'cookie':
        if (session.cookie !== undefined) return false;
        session.cookie = value;
        break;
      case 'referer':
        if (session.referrer !== undefined || httpLink(value) !== value)
          return false;
        session.referrer = value;
        break;
      case 'user-agent':
        // Ario can replay GET without browser fingerprint headers.
        break;
      default:
        // Authorization, partial transfers, body headers, and custom inputs
        // cannot be reproduced by the handoff protocol.
        return false;
    }
  }
  return session;
}

export function eligibleDownload(item: Item) {
  return (
    item.incognito === false &&
    !item.byExtensionId &&
    item.danger === 'safe' &&
    item.state === 'in_progress' &&
    !item.paused
  );
}

export function observeDownloads() {
  const requests = new Map<string, Observation>();
  let detach: (() => void) | undefined;
  let saturatedUntil = 0;

  function prune(now: number) {
    for (const [id, observation] of requests) {
      if (
        now - observation.updated >
        (observation.received ? matchWindow * 2 : observationLifetime)
      )
        requests.delete(id);
    }
  }

  const begin = (
    details: Browser.webRequest.OnBeforeRequestDetails & {
      originUrl?: string;
      incognito?: boolean;
    },
  ): undefined => {
    const { requestId, method, timeStamp, url, requestBody } = details;
    const href = httpLink(url);
    const initiator = details.initiator ?? details.originUrl;
    if (
      !href ||
      details.incognito ||
      (initiator && !/^https?:\/\//i.test(initiator))
    )
      return;
    prune(timeStamp);
    const previous = requests.get(requestId);
    const rejected = method !== 'GET' || requestBody != null;
    if (previous) {
      previous.rejected ||= rejected || previous.next !== href;
      previous.current = href;
      previous.next = undefined;
      previous.updated = timeStamp;
      previous.sent = false;
      previous.session = undefined;
      return;
    }
    if (requests.size >= maximumObservations) {
      saturatedUntil = timeStamp + observationLifetime;
      return;
    }
    requests.set(requestId, {
      first: href,
      current: href,
      started: timeStamp,
      updated: timeStamp,
      rejected,
      sent: false,
      claimed: false,
    });
    return undefined;
  };

  const sent = (details: Browser.webRequest.OnSendHeadersDetails) => {
    const entry = requests.get(details.requestId);
    if (!entry) return;
    const headers = details.requestHeaders;
    const session = headers && requestSession(headers);
    entry.rejected ||=
      entry.sent ||
      details.method !== 'GET' ||
      entry.current !== httpLink(details.url) ||
      !session;
    entry.sent = true;
    entry.updated = details.timeStamp;
    entry.session = session || undefined;
  };

  const received = (
    details: Browser.webRequest.OnHeadersReceivedDetails,
  ): undefined => {
    const entry = requests.get(details.requestId);
    if (!entry) return;
    entry.updated = details.timeStamp;
    if (details.statusCode >= 300 && details.statusCode < 400) return;
    entry.received = details.timeStamp;
    entry.rejected ||=
      details.statusCode !== 200 ||
      !entry.sent ||
      details.method !== 'GET' ||
      entry.current !== httpLink(details.url);
    return undefined;
  };

  const redirect = (details: Browser.webRequest.OnBeforeRedirectDetails) => {
    const entry = requests.get(details.requestId);
    if (!entry) return;
    entry.next = httpLink(details.redirectUrl);
    entry.received = undefined;
    entry.rejected ||=
      !entry.next ||
      entry.current !== httpLink(details.url) ||
      details.method !== 'GET' ||
      !entry.sent;
    entry.updated = details.timeStamp;
  };

  const end = (details: { requestId: string }) => {
    if (!requests.get(details.requestId)?.received)
      requests.delete(details.requestId);
  };

  function attach() {
    const api = browser.webRequest;
    if (!api || detach) return;
    const filter = {
      urls: capturePermissions.origins!,
      // Download navigations and browser save actions are reported here.
      types: ['main_frame', 'sub_frame', 'other'] as const,
    };
    const requestFilter = { ...filter, types: [...filter.types] };
    api.onBeforeRequest.addListener(begin, requestFilter, ['requestBody']);
    api.onSendHeaders.addListener(
      sent,
      requestFilter,
      import.meta.env.FIREFOX
        ? ['requestHeaders']
        : ['requestHeaders', 'extraHeaders'],
    );
    api.onHeadersReceived.addListener(received, requestFilter);
    api.onBeforeRedirect.addListener(redirect, requestFilter);
    api.onCompleted.addListener(end, requestFilter);
    api.onErrorOccurred.addListener(end, requestFilter);
    detach = () => {
      api.onBeforeRequest.removeListener(begin);
      api.onSendHeaders.removeListener(sent);
      api.onHeadersReceived.removeListener(received);
      api.onBeforeRedirect.removeListener(redirect);
      api.onCompleted.removeListener(end);
      api.onErrorOccurred.removeListener(end);
    };
  }

  function stop() {
    const removeListeners = detach;
    detach = undefined;
    requests.clear();
    saturatedUntil = 0;
    try {
      removeListeners?.();
    } catch {
      // Firefox can remove the event APIs before notifying us of revocation.
    }
  }

  function match(item: Item, now = Date.now()) {
    const initial = httpLink(item.url);
    const final = item.finalUrl ? httpLink(item.finalUrl) : undefined;
    const started = Date.parse(item.startTime);
    if (
      !initial ||
      (item.finalUrl && !final) ||
      !Number.isFinite(started) ||
      now < saturatedUntil
    )
      return;
    prune(now);
    // Browser download events have no webRequest ID. Count competing matches,
    // even rejected or previously claimed ones, before selecting a request.
    const candidates = [...requests.values()].filter((entry) => {
      const urlsMatch = final
        ? entry.first === initial && entry.current === final
        : entry.first === initial || entry.current === initial;
      return (
        urlsMatch &&
        (entry.received !== undefined
          ? Math.abs(entry.received - started) <= matchWindow
          : entry.started <= started + matchWindow)
      );
    });
    const [entry] = candidates;
    if (
      candidates.length !== 1 ||
      !entry ||
      entry.rejected ||
      entry.claimed ||
      entry.received === undefined ||
      !entry.session
    )
      return;
    entry.claimed = true;
    const session = entry.session;
    entry.session = undefined;
    return { url: entry.current, session };
  }

  return { attach, detach: stop, match };
}
