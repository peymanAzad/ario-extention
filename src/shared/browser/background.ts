import { browser, type Browser } from 'wxt/browser';
import { runDownloadOperation } from '@/shared/api/download-operations';
import { runQueueOperation } from '@/shared/api/queue-operations';
import { readBrowserCapabilities } from '@/shared/api/browser-handoffs';
import { writeDownloadDraft } from '@/shared/storage/download-draft';
import { requestDaemon } from '@/shared/api/transport';
import { writeDashboardFilters } from '@/shared/storage/dashboard';
import { updateSettings } from '@/shared/storage/settings';
import {
  healthSchema,
  daemonSettingsSchema,
  downloadLiveStatusSchema,
  queueSchema,
} from '@/shared/types/daemon';
import { ArioError } from '@/shared/types/connection';
import {
  backgroundMessageSchema,
  type BackgroundReply,
  type BackgroundResults,
} from '@/shared/types/messages';
import { createCapture } from './capture';
import { createConfirmations } from './confirmations';
import { createMedia } from './media';

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

export function createBackgroundHandler(
  confirmations = createConfirmations(),
  capture = createCapture(),
  media = createMedia(confirmations.openMedia),
) {
  const requests = new Map<string, AbortController>();

  return function onMessage(
    message: unknown,
    sender: Browser.runtime.MessageSender,
  ): Promise<Reply> | undefined {
    if (!isTrustedUi(sender)) return media.onPageMessage(message, sender);
    const parsed = backgroundMessageSchema.safeParse(message);
    if (!parsed.success) return undefined;

    return dispatch(parsed.data, sender);
  };

  async function dispatch(
    message: ReturnType<typeof backgroundMessageSchema.parse>,
    sender: Browser.runtime.MessageSender,
  ): Promise<Reply> {
    if (message.operation === 'dashboard.update') {
      try {
        return { ok: true, data: await writeDashboardFilters(message.filters) };
      } catch {
        return {
          ok: false,
          error: {
            kind: 'storage',
            message: 'Could not remember dashboard filters.',
          },
        };
      }
    }

    if (message.operation === 'downloadDraft.update') {
      try {
        await writeDownloadDraft(message.draft);
        return { ok: true, data: null };
      } catch {
        return {
          ok: false,
          error: {
            kind: 'storage',
            message: 'Could not remember the download draft.',
          },
        };
      }
    }

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

    if (!('requestId' in message)) {
      try {
        let data: BackgroundResults[keyof BackgroundResults];
        switch (message.operation) {
          case 'media.list':
            data = await media.list();
            break;
          case 'media.open':
            await media.openFromPopup(message.id);
            data = null;
            break;
          case 'capture.enable':
            data = await capture.setEnabled(message.enabled);
            break;
          case 'capture.preferences':
            data = await capture.savePreferences(message.patch);
            break;
          case 'capture.list':
            data = await capture.list();
            break;
          case 'capture.open':
            await capture.reopen(message.id);
            data = null;
            break;
          case 'capture.dismiss':
            await capture.dismiss(message.id);
            data = null;
            break;
          case 'capture.keep':
            data = await capture.keep(
              message.id,
              sender.url?.split(/[?#]/, 1)[0] ===
                browser.runtime.getURL('/popup.html')
                ? undefined
                : sender,
            );
            break;
          case 'capture.retry':
            data = await capture.retryBrowser(message.id);
            break;
          case 'confirmation.get':
            data =
              (await capture.get(message.id, sender)) ??
              (await confirmations.get(message.id, sender));
            break;
          case 'confirmation.check':
            data = (await capture.get(message.id, sender))
              ? await capture.check(message.id, sender)
              : await confirmations.check(message.id, sender);
            break;
          case 'confirmation.submit':
            data = (await capture.get(message.id, sender))
              ? await capture.submit(
                  message.id,
                  message.options,
                  message.suppressCapture ?? false,
                  sender,
                )
              : await confirmations.submit(
                  message.id,
                  message.options,
                  message.session,
                  sender,
                );
            break;
        }
        return { ok: true, data };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof ArioError
              ? error.detail
              : {
                  kind: 'extension',
                  message:
                    'Browser download controls are temporarily unavailable. Try again.',
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
      let data: BackgroundResults[keyof BackgroundResults];
      switch (message.operation) {
        case 'daemon.health':
          data = await requestDaemon(
            message.origin,
            '/health',
            healthSchema,
            options,
          );
          break;
        case 'daemon.settings':
          data = await requestDaemon(
            message.origin,
            '/settings',
            daemonSettingsSchema,
            options,
          );
          break;
        case 'daemon.browserCapabilities':
          data = await readBrowserCapabilities(
            message.origin,
            controller.signal,
          );
          break;
        case 'daemon.downloads':
          data = await requestDaemon(
            message.origin,
            '/downloads',
            downloadLiveStatusSchema.array(),
            options,
          );
          break;
        case 'daemon.queues':
          data = await requestDaemon(
            message.origin,
            '/queues',
            queueSchema.array(),
            options,
          );
          break;
        case 'daemon.queue':
          data = await requestDaemon(
            message.origin,
            `/queues/${message.id}`,
            queueSchema,
            options,
          );
          break;
        case 'daemon.queue.create':
        case 'daemon.queue.update':
        case 'daemon.queue.action':
        case 'daemon.queue.delete':
          data = await runQueueOperation(message, controller.signal);
          break;
        default:
          data = await runDownloadOperation(message, controller.signal);
          break;
      }
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
