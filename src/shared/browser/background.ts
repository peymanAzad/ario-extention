import { browser, type Browser } from 'wxt/browser';
import { requestDaemon } from '@/shared/api/transport';
import { updateSettings } from '@/shared/storage/settings';
import { healthSchema, daemonSettingsSchema } from '@/shared/types/daemon';
import { ArioError } from '@/shared/types/connection';
import {
  backgroundMessageSchema,
  type BackgroundReply,
  type BackgroundResults,
} from '@/shared/types/messages';

const uiPages = ['/popup.html', '/options.html', '/confirmation.html'] as const;
type Reply = BackgroundReply<BackgroundResults[keyof BackgroundResults]>;

export function isTrustedUi(sender: Browser.runtime.MessageSender): boolean {
  if (
    sender.id !== browser.runtime.id ||
    !sender.url ||
    (sender.frameId ?? 0) !== 0
  ) {
    return false;
  }
  const [documentUrl] = sender.url.split(/[?#]/, 1);
  return uiPages.some((page) => browser.runtime.getURL(page) === documentUrl);
}

export function createBackgroundHandler() {
  const requests = new Map<string, AbortController>();

  return function onMessage(
    message: unknown,
    sender: Browser.runtime.MessageSender,
  ): Promise<Reply> | undefined {
    if (!isTrustedUi(sender)) return undefined;
    const parsed = backgroundMessageSchema.safeParse(message);
    if (!parsed.success) return undefined;

    return dispatch(parsed.data, sender);
  };

  async function dispatch(
    message: ReturnType<typeof backgroundMessageSchema.parse>,
    sender: Browser.runtime.MessageSender,
  ): Promise<Reply> {
    if (message.operation === 'settings.update') {
      try {
        return { ok: true, data: await updateSettings(message.patch) };
      } catch {
        return {
          ok: false,
          error: {
            kind: 'storage',
            message: 'Could not save extension settings.',
          },
        };
      }
    }

    const requestKey = JSON.stringify([
      sender.documentId ?? sender.url,
      sender.tab?.id,
      message.requestId,
    ]);
    if (message.operation === 'daemon.cancel') {
      requests.get(requestKey)?.abort();
      return { ok: true, data: null };
    }
    if (requests.has(requestKey)) {
      return {
        ok: false,
        error: {
          kind: 'extension',
          message: 'A request with this ID is already running.',
        },
      };
    }

    const controller = new AbortController();
    requests.set(requestKey, controller);
    try {
      const options = { signal: controller.signal };
      const data =
        message.operation === 'daemon.health'
          ? await requestDaemon(
              message.origin,
              '/health',
              healthSchema,
              options,
            )
          : await requestDaemon(
              message.origin,
              '/settings',
              daemonSettingsSchema,
              options,
            );
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof ArioError
            ? error.detail
            : {
                kind: 'extension',
                message: 'The extension could not make the daemon request.',
              },
      };
    } finally {
      requests.delete(requestKey);
    }
  }
}
