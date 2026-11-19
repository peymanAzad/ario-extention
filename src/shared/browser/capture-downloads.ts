import { browser, type Browser } from 'wxt/browser';
import type { DownloadIdentity } from './capture-storage';
import { eligibleDownload } from './download-observation';

type Item = Browser.downloads.DownloadItem;

export const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function findBrowserDownload({
  browserId,
  startedAt,
}: DownloadIdentity) {
  const api = browser.downloads;
  if (!api) throw new Error('Downloads permission is unavailable');
  if (!import.meta.env.FIREFOX) {
    const [item] = await api.search({ id: browserId });
    return item?.incognito === false && item.startTime === startedAt
      ? item
      : undefined;
  }

  // Firefox reassigns download IDs when it rebuilds its download list.
  const time = Date.parse(startedAt);
  const nearby = await api.search({
    startedAfter: new Date(time - 1).toISOString(),
    startedBefore: new Date(time + 1).toISOString(),
  });
  const exact = nearby.filter(
    (candidate) => !candidate.incognito && candidate.startTime === startedAt,
  );
  return exact.length === 1 ? exact[0] : undefined;
}

export async function findPausableDownload(identity: DownloadIdentity) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const item = await findBrowserDownload(identity);
    if (!item || !eligibleDownload(item)) return;
    // Firefox can stop a download without making it resumable if no bytes
    // have been written yet. Wait briefly for a partial file.
    if (!import.meta.env.FIREFOX || item.bytesReceived > 0) return item;
    await delay(80);
  }
}

export function safelyPaused(item: Item | undefined): item is Item {
  return Boolean(
    item &&
    !item.incognito &&
    item.danger === 'safe' &&
    item.paused &&
    item.canResume &&
    item.state !== 'complete',
  );
}

export function canceledDownload(item: Item | undefined) {
  // Chrome can retain paused=true after a successful cancellation.
  return (
    item?.state === 'interrupted' &&
    !item.canResume &&
    item.error === 'USER_CANCELED'
  );
}

export async function resumeBrowserDownload(item: Item) {
  const api = browser.downloads;
  if (!api) return false;
  let rejected = false;
  const resumption = api.resume(item.id).catch(() => {
    rejected = true;
  });
  if (!import.meta.env.FIREFOX) await resumption;
  // Firefox's resume promise can remain pending until the transfer ends.
  for (let attempt = 0; attempt < 10; attempt++) {
    const [current] = await api.search({ id: item.id });
    if (
      current?.state === 'complete' ||
      (current?.state === 'in_progress' && !current.paused)
    )
      return true;
    if (rejected) return false;
    await delay(50);
  }
  return false;
}

export function suggestedFilename(path: string) {
  const name = path.split(/[/\\]/).at(-1);
  if (
    !name ||
    name.trim() !== name ||
    name.endsWith('.') ||
    /[\p{Cc}:<>|"?*]/u.test(name) ||
    new TextEncoder().encode(name).length > 255
  )
    return undefined;
  const stem = name.split('.')[0]!.trimEnd().toUpperCase();
  return /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|(?:COM|LPT)[1-9¹²³])$/.test(stem)
    ? undefined
    : name;
}
