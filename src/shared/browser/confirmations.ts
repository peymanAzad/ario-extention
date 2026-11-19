import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';
import {
  isHandoffRejection,
  readBrowserCapabilities,
  readBrowserHandoff,
  resolveBrowserHandoff,
  stageBrowserHandoff,
  type HandoffReceipt,
} from '@/shared/api/browser-handoffs';
import { readSettings } from '@/shared/storage/settings';
import { supportsBrowserHandoff } from '@/shared/types/browser-capabilities';
import { ArioError } from '@/shared/types/connection';
import {
  confirmationIdSchema,
  handoffLink,
  type ConfirmationDraft,
  type ConfirmationOutcome,
} from '@/shared/types/confirmation';
import {
  downloadIdSchema,
  type ImportOptions,
} from '@/shared/types/download-workflows';
import { daemonOriginSchema } from '@/shared/types/settings';
import {
  readSessionCookie,
  sessionHostPattern,
  sessionSource,
} from './browser-session';

const menuId = 'ario-download-link';
const confirmationPage = '/confirmation.html';
const storagePrefix = 'arioConfirmation:';
const storageKey = (id: string) => `${storagePrefix}${id}`;

const draftSchema = z.object({
  windowId: z.int().nonnegative(),
  origin: daemonOriginSchema,
  url: z.string(),
  source: z
    .object({ tabId: z.int().nonnegative(), pageUrl: z.string() })
    .nullable(),
  downloadId: downloadIdSchema.optional(),
});
type Draft = z.infer<typeof draftSchema>;

// Only the identifiers and daemon origin are durable. Active links and source
// tabs live in session storage. Cookies exist only while preparing a stage.
const journalSchema = z.object({
  id: confirmationIdSchema,
  origin: daemonOriginSchema,
  phase: z.enum(['stage', 'commit', 'abort']),
});
type Journal = z.infer<typeof journalSchema>;

async function readDraft(id: string) {
  const key = storageKey(id);
  return draftSchema.safeParse((await browser.storage.session.get(key))[key])
    .data;
}

async function readJournal(id: string) {
  const key = storageKey(id);
  return journalSchema.safeParse((await browser.storage.local.get(key))[key])
    .data;
}

function saveJournal(id: string, entry: Journal) {
  return browser.storage.local.set({ [storageKey(id)]: entry });
}

const editing = { state: 'draft' } as const;
const pending = { state: 'pending' } as const;

const confirmationError = (message: string) =>
  new ArioError({ kind: 'extension', message });

export function createConfirmations() {
  const opening = new Map<string, Promise<void>>();
  const submitting = new Map<string, Promise<ConfirmationOutcome>>();

  function windowUrl(id: string) {
    return `${browser.runtime.getURL(confirmationPage)}#${id}`;
  }

  async function open(
    info: Browser.contextMenus.OnClickData,
    tab?: Browser.tabs.Tab,
  ) {
    if (info.menuItemId !== menuId) return;
    const link = handoffLink(info.linkUrl);
    if (!link) return;

    const id = crypto.randomUUID();
    const start = async () => {
      const { connection } = await readSettings();
      const popup = await browser.windows.create({
        type: 'popup',
        url: windowUrl(id),
        focused: true,
        width: 500,
        height: 565,
        ...(tab?.incognito && { incognito: true }),
      });
      if (popup?.id === undefined) return;
      const draft: Draft = {
        windowId: popup.id,
        origin: connection.origin,
        url: link.href,
        source: sessionSource(link, info, tab),
      };
      await browser.storage.session.set({ [storageKey(id)]: draft });
    };
    const opened = start();
    opening.set(id, opened);
    try {
      await opened;
    } finally {
      opening.delete(id);
    }
  }

  async function getOwnedDraft(
    id: string,
    sender: Browser.runtime.MessageSender,
  ) {
    if (
      (sender.url !== windowUrl(id) &&
        sender.url !== browser.runtime.getURL(confirmationPage)) ||
      sender.tab?.windowId === undefined
    )
      return undefined;
    await opening.get(id);
    const draft = await readDraft(id);
    return draft?.windowId === sender.tab.windowId ? draft : undefined;
  }

  function run(id: string, operation: () => Promise<ConfirmationOutcome>) {
    const existing = submitting.get(id);
    if (existing) return existing;
    const running = operation().finally(() => submitting.delete(id));
    submitting.set(id, running);
    return running;
  }

  async function finish(
    id: string,
    receipt: HandoffReceipt | null,
  ): Promise<ConfirmationOutcome> {
    if (receipt?.state === 'staged') return pending;
    if (receipt?.state === 'committed') {
      const draft = await readDraft(id);
      if (draft) {
        await browser.storage.session.set({
          [storageKey(id)]: { ...draft, downloadId: receipt.download_id },
        });
      }
      await browser.storage.local.remove(storageKey(id));
      return { state: 'committed', downloadId: receipt.download_id };
    }

    await browser.storage.local.remove(storageKey(id));
    return editing;
  }

  async function performAction(
    id: string,
    entry: Journal,
  ): Promise<ConfirmationOutcome> {
    const action = entry.phase === 'abort' ? 'abort' : 'commit';
    let receipt;
    try {
      receipt = await resolveBrowserHandoff(entry.origin, entry.id, action);
    } catch (error) {
      receipt = await readBrowserHandoff(entry.origin, entry.id).catch(
        () => undefined,
      );
      if (receipt === undefined) return pending;
      if (receipt?.state !== 'staged') return finish(id, receipt);
      if (action === 'abort' || !isHandoffRejection(error)) return pending;

      // A rejected commit can leave a staged payload on the daemon. Record
      // the abort decision before trying it so a restart cannot commit it.
      const abort = { ...entry, phase: 'abort' } as const;
      await saveJournal(id, abort);
      const result = await performAction(id, abort);
      if (result.state === 'draft') throw error;
      return result;
    }
    return finish(id, receipt);
  }

  async function recover(id: string, entry: Journal, waitingForStage = false) {
    const receipt = await readBrowserHandoff(entry.origin, entry.id).catch(
      () => undefined,
    );
    if (receipt === undefined || (waitingForStage && receipt === null))
      return pending;
    if (receipt?.state !== 'staged') return finish(id, receipt);
    if (entry.phase === 'stage') {
      entry = { ...entry, phase: 'commit' };
      await saveJournal(id, entry);
    }
    return performAction(id, entry);
  }

  async function get(
    id: string,
    sender: Browser.runtime.MessageSender,
  ): Promise<ConfirmationDraft | null> {
    const draft = await getOwnedDraft(id, sender);
    if (!draft) return null;
    const outcome: ConfirmationOutcome = draft.downloadId
      ? { state: 'committed', downloadId: draft.downloadId }
      : (await readJournal(id))
        ? pending
        : editing;
    return {
      id,
      url: draft.url,
      origin: draft.origin,
      sessionHost: draft.source ? sessionHostPattern(new URL(draft.url)) : null,
      outcome,
    };
  }

  async function check(id: string, sender: Browser.runtime.MessageSender) {
    if (!(await getOwnedDraft(id, sender)))
      throw confirmationError('This confirmation has expired.');
    return run(id, async () => {
      const draft = await readDraft(id);
      if (draft?.downloadId)
        return { state: 'committed', downloadId: draft.downloadId };
      const entry = await readJournal(id);
      return entry ? recover(id, entry) : editing;
    });
  }

  async function submit(
    id: string,
    options: ImportOptions,
    session: boolean,
    sender: Browser.runtime.MessageSender,
  ) {
    if (!(await getOwnedDraft(id, sender)))
      throw confirmationError('This confirmation has expired.');
    return run(id, async () => {
      const draft = await readDraft(id);
      if (!draft) throw confirmationError('This confirmation has expired.');
      if (draft.downloadId)
        return { state: 'committed', downloadId: draft.downloadId };
      const existing = await readJournal(id);
      if (existing) return recover(id, existing);

      const capabilities = await readBrowserCapabilities(draft.origin);
      if (!supportsBrowserHandoff(capabilities))
        throw confirmationError(
          'Upgrade the Ario daemon to a version that supports browser downloads.',
        );
      if (session && !capabilities?.http_session)
        throw confirmationError(
          'This daemon cannot use browser cookies. Turn off browser session to send the public link.',
        );

      const cookie = session
        ? await readSessionCookie(new URL(draft.url), draft.source)
        : undefined;
      const entry: Journal = {
        id: crypto.randomUUID(),
        origin: draft.origin,
        phase: 'stage',
      };
      await saveJournal(id, entry);
      let receipt;
      try {
        receipt = await stageBrowserHandoff(
          entry.origin,
          entry.id,
          draft.url,
          options,
          cookie === undefined ? undefined : { cookie },
        );
      } catch (error) {
        if (!isHandoffRejection(error)) return recover(id, entry, true);
        await browser.storage.local.remove(storageKey(id));
        throw error;
      }
      if (receipt.state !== 'staged') return finish(id, receipt);

      const commit = { ...entry, phase: 'commit' } as const;
      await saveJournal(id, commit);
      return performAction(id, commit);
    });
  }

  async function discardClosedDrafts(windowId?: number) {
    const drafts = await browser.storage.session.get(null);
    const windows =
      windowId === undefined ? await browser.windows.getAll() : [];
    const windowIds = new Set(windows.map((window) => window.id));
    await Promise.all(
      Object.entries(drafts).map(async ([key, value]) => {
        if (!key.startsWith(storagePrefix)) return;
        const draft = draftSchema.safeParse(value).data;
        if (!draft) return;
        if (
          windowId === undefined
            ? windowIds.has(draft.windowId)
            : draft.windowId !== windowId
        )
          return;
        await submitting
          .get(key.slice(storagePrefix.length))
          ?.catch(() => undefined);
        await browser.storage.session.remove(key);
      }),
    );
  }

  async function reconcile() {
    await discardClosedDrafts();
    const entries = await browser.storage.local.get(null);
    await Promise.allSettled(
      Object.entries(entries).map(async ([key, value]) => {
        if (!key.startsWith(storagePrefix)) return;
        const id = confirmationIdSchema.safeParse(
          key.slice(storagePrefix.length),
        ).data;
        const entry = journalSchema.safeParse(value).data;
        if (id && entry)
          await run(id, async () => {
            const latest = await readJournal(id);
            return latest ? recover(id, latest) : editing;
          });
      }),
    );
  }

  function register() {
    browser.runtime.onInstalled.addListener(() => {
      // Chrome match patterns omit the magnet scheme. Validate the click URL.
      browser.contextMenus.create({
        id: menuId,
        title: 'Download with Ario',
        contexts: ['link'],
      });
    });
    browser.contextMenus.onClicked.addListener((info, tab) => {
      void open(info, tab).catch(() => undefined);
    });
    browser.windows.onRemoved.addListener((windowId) => {
      void Promise.allSettled(opening.values())
        .then(() => discardClosedDrafts(windowId))
        .catch(() => undefined);
    });
    browser.runtime.onStartup.addListener(
      () => void reconcile().catch(() => undefined),
    );
    void reconcile().catch(() => undefined);
  }

  return { register, open, get, check, submit, reconcile, discardClosedDrafts };
}
