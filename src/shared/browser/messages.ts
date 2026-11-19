import { browser } from 'wxt/browser';
import { ArioError, cancelled } from '@/shared/types/connection';
import type {
  BackgroundMessage,
  BackgroundReply,
  BackgroundResults,
} from '@/shared/types/messages';
import type {
  DownloadDraft,
  ImportOptions,
} from '@/shared/types/download-workflows';
import type { DashboardFilters } from '@/shared/types/dashboard';
import type {
  CaptureSettingsPatch,
  SettingsPatch,
} from '@/shared/types/settings';

type Operation = keyof BackgroundResults;
type Payloads = {
  [K in Operation]: Omit<
    Extract<BackgroundMessage, { operation: K }>,
    'operation'
  >;
};

async function send<K extends Operation>(
  operation: K,
  payload: Payloads[K],
): Promise<BackgroundResults[K]> {
  let reply: BackgroundReply<BackgroundResults[K]> | undefined;
  try {
    reply = await browser.runtime.sendMessage({ operation, ...payload });
  } catch {
    // A reloaded or unavailable background may close the message channel.
  }
  if (!reply) {
    throw new ArioError({
      kind: 'extension',
      message:
        'The extension background is unavailable. Try reopening this page.',
    });
  }
  if (!reply.ok) throw new ArioError(reply.error);
  return reply.data;
}

type DaemonRead =
  | 'daemon.health'
  | 'daemon.settings'
  | 'daemon.browserCapabilities'
  | 'daemon.downloads'
  | 'daemon.queues'
  | 'daemon.queue'
  | 'daemon.download';

async function daemonRequest<K extends DaemonRead>(
  operation: K,
  payload: Payloads[K],
  signal?: AbortSignal,
): Promise<BackgroundResults[K]> {
  if (signal?.aborted) throw new ArioError(cancelled);
  const { requestId } = payload;
  const cancel = () => {
    void send('daemon.cancel', { requestId }).catch(() => {
      // The background also bounds each fetch with a timeout.
    });
  };

  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await send(operation, payload);
    if (signal?.aborted) throw new ArioError(cancelled);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export const checkDaemon = (origin: string, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.health',
    { origin, requestId: crypto.randomUUID() },
    signal,
  );

export const getDaemonSettings = (origin: string, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.settings',
    { origin, requestId: crypto.randomUUID() },
    signal,
  );

export const getBrowserCapabilities = (origin: string, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.browserCapabilities',
    { origin, requestId: crypto.randomUUID() },
    signal,
  );

export const saveSettings = (patch: SettingsPatch) =>
  send('settings.update', { patch });

export const getConfirmation = (id: string) => send('confirmation.get', { id });

export const checkConfirmation = (id: string) =>
  send('confirmation.check', { id });

export const submitConfirmation = (
  id: string,
  options: ImportOptions,
  session: boolean,
  suppressCapture?: boolean,
) => send('confirmation.submit', { id, options, session, suppressCapture });

export const enableCapture = (enabled: boolean) =>
  send('capture.enable', { enabled });
export const saveCapturePreferences = (patch: CaptureSettingsPatch) =>
  send('capture.preferences', { patch });
export const getCaptureNotices = () => send('capture.list', {});
export const openCapture = (id: string) => send('capture.open', { id });
export const keepCapture = (id: string) => send('capture.keep', { id });
export const retryCapture = (id: string) => send('capture.retry', { id });
export const dismissCapture = (id: string) => send('capture.dismiss', { id });

export const getDownloads = (origin: string, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.downloads',
    { origin, requestId: crypto.randomUUID() },
    signal,
  );

export const getQueues = (origin: string, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.queues',
    { origin, requestId: crypto.randomUUID() },
    signal,
  );

export const getQueue = (origin: string, id: number, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.queue',
    { origin, id, requestId: crypto.randomUUID() },
    signal,
  );

export const saveDashboardFilters = (filters: DashboardFilters) =>
  send('dashboard.update', { filters });

export const getDownload = (origin: string, id: number, signal?: AbortSignal) =>
  daemonRequest(
    'daemon.download',
    { origin, id, requestId: crypto.randomUUID() },
    signal,
  );

export const saveDownloadDraft = (draft: DownloadDraft) =>
  send('downloadDraft.update', { draft });

type DownloadWrite = Extract<Operation, `daemon.download.${string}`>;
type QueueWrite = Extract<Operation, `daemon.queue.${string}`>;

function daemonWrite<K extends DownloadWrite | QueueWrite>(
  operation: K,
  payload: Omit<Payloads[K], 'requestId'>,
) {
  return send(operation, {
    ...payload,
    requestId: crypto.randomUUID(),
  } as Payloads[K]);
}

export function writeDownload<K extends DownloadWrite>(
  operation: K,
  payload: Omit<Payloads[K], 'requestId'>,
) {
  return daemonWrite(operation, payload);
}

export const writeQueue = <K extends QueueWrite>(
  operation: K,
  payload: Omit<Payloads[K], 'requestId'>,
) => daemonWrite(operation, payload);

export async function uploadTorrent(
  origin: string,
  file: File,
  options: ImportOptions,
) {
  // Chrome runtime messages use JSON serialization. A data URL keeps the
  // message below the browser limit without expanding each byte into a number.
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () =>
      reject(new Error('Could not read the torrent file.'));
    reader.readAsDataURL(file);
  });
  return writeDownload('daemon.download.torrent', {
    origin,
    file: { name: file.name, base64 },
    options,
  });
}
