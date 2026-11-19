import { browser } from 'wxt/browser';
import { ArioError, cancelled } from '@/shared/types/connection';
import type {
  BackgroundMessage,
  BackgroundReply,
  BackgroundResults,
} from '@/shared/types/messages';
import type { DashboardFilters } from '@/shared/types/dashboard';
import type { SettingsPatch } from '@/shared/types/settings';

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

type DaemonOperation =
  'daemon.health' | 'daemon.settings' | 'daemon.downloads' | 'daemon.queues';

async function daemonRequest<K extends DaemonOperation>(
  operation: K,
  origin: string,
  signal?: AbortSignal,
): Promise<BackgroundResults[K]> {
  if (signal?.aborted) throw new ArioError(cancelled);
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void send('daemon.cancel', { requestId }).catch(() => {
      // The background also bounds each fetch with a timeout.
    });
  };

  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await send(operation, { requestId, origin });
    if (signal?.aborted) throw new ArioError(cancelled);
    return result;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export const checkDaemon = (origin: string, signal?: AbortSignal) =>
  daemonRequest('daemon.health', origin, signal);

export const getDaemonSettings = (origin: string, signal?: AbortSignal) =>
  daemonRequest('daemon.settings', origin, signal);

export const saveSettings = (patch: SettingsPatch) =>
  send('settings.update', { patch });

export const getDownloads = (origin: string, signal?: AbortSignal) =>
  daemonRequest('daemon.downloads', origin, signal);

export const getQueues = (origin: string, signal?: AbortSignal) =>
  daemonRequest('daemon.queues', origin, signal);

export const saveDashboardFilters = (filters: DashboardFilters) =>
  send('dashboard.update', { filters });
