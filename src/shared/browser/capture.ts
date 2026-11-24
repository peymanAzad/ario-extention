import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';
import {
  isHandoffRejection,
  readBrowserCapabilities,
  readBrowserHandoff,
  resolveBrowserHandoff,
  stageBrowserHandoff,
  type HandoffReceipt,
  type HandoffSession,
} from '@/shared/api/browser-handoffs';
import { requestDaemon } from '@/shared/api/transport';
import {
  readSettings,
  updateSettings,
  watchSettings,
} from '@/shared/storage/settings';
import { supportsBrowserHandoff } from '@/shared/types/browser-capabilities';
import type { CaptureNotice } from '@/shared/types/capture';
import { ArioError } from '@/shared/types/connection';
import type {
  ConfirmationDraft,
  HandoffOutcome as ConfirmationOutcome,
} from '@/shared/types/confirmation';
import { queueSchema } from '@/shared/types/daemon';
import type { ImportOptions } from '@/shared/types/download-workflows';
import type { CaptureSettingsPatch } from '@/shared/types/settings';
import {
  canceledDownload,
  delay,
  findBrowserDownload,
  findPausableDownload,
  resumeBrowserDownload,
  safelyPaused,
  suggestedFilename,
} from './capture-downloads';
import {
  listCaptureDrafts,
  listCaptures,
  readCapture,
  readCaptureDraft,
  removeCapture,
  removeCaptureDraft,
  saveCapture,
  saveCaptureDraft,
  type CaptureDraft,
  type CaptureRecord,
} from './capture-storage';
import {
  capturePermissions,
  eligibleDownload,
  observeDownloads,
} from './download-observation';

const alarmName = 'ario-capture-recovery';
const confirmationPage = '/confirmation.html';
const draftOutcome = { state: 'draft' } as const;
const pending = { state: 'pending' } as const;
const inBrowser = { state: 'browser' } as const;
const recovery = { state: 'recovery' } as const;
type Fallback = Extract<CaptureRecord, { phase: 'fallback' }>;
type Submission = Extract<CaptureRecord, { handoffId: string }>;

const captureError = (message: string) =>
  new ArioError({ kind: 'extension', message });
const ignore = () => undefined;
export function createCapture() {
  const observer = observeDownloads();
  const operations = new Map<string, Promise<ConfirmationOutcome>>();
  const opening = new Map<string, Promise<void>>();
  const preparing = new Set<string>();
  // Never write observed request headers to extension storage.
  const sessions = new Map<string, HandoffSession>();
  let statusUpdate: Promise<void> = Promise.resolve();
  let listenerUpdate = Promise.resolve(false);

  const permissionGranted = () =>
    browser.permissions.contains(capturePermissions);
  const windowUrl = (id: string) =>
    `${browser.runtime.getURL(confirmationPage)}#${id}`;

  async function list(): Promise<CaptureNotice[]> {
    const current = await listCaptures();
    const drafts = new Map(
      (await listCaptureDrafts()).map(({ id, draft }) => [id, draft]),
    );
    return current.flatMap(({ id, record }): CaptureNotice[] => {
      const draft = drafts.get(id);
      const fileName = draft?.fileName;
      if (
        record.phase === 'recovery' ||
        (record.phase === 'fallback' && record.browser === 'recovery')
      )
        return [
          {
            id,
            state: 'recovery',
            fileName,
            canDismiss: record.phase === 'recovery',
          },
        ];
      if (record.phase === 'awaiting' && draft && draft.windowId === undefined)
        return [{ id, state: 'confirmation', fileName }];
      if (['staging', 'canceling', 'commit', 'fallback'].includes(record.phase))
        return [{ id, state: 'pending', fileName }];
      return [];
    });
  }

  function refreshStatus() {
    statusUpdate = statusUpdate.catch(ignore).then(async () => {
      const records = await listCaptures();
      const alarm = await browser.alarms.get(alarmName);
      if (records.some(({ record }) => record.phase !== 'recovery')) {
        if (!alarm)
          await browser.alarms.create(alarmName, { periodInMinutes: 1 });
      } else if (alarm) {
        await browser.alarms.clear(alarmName);
      }
      const actionable = (await list()).filter(
        ({ state }) => state !== 'pending',
      );
      await browser.action.setBadgeText({
        text: actionable.length ? String(actionable.length) : '',
      });
    });
    return statusUpdate.catch(ignore);
  }

  function run(id: string, action: () => Promise<ConfirmationOutcome>) {
    const existing = operations.get(id);
    const operation = (
      existing ? existing.catch(ignore).then(action) : action()
    ).finally(() => {
      if (operations.get(id) === operation) operations.delete(id);
      void refreshStatus();
    });
    operations.set(id, operation);
    return operation;
  }

  async function finish(id: string, outcome: ConfirmationOutcome) {
    const draft = await readCaptureDraft(id);
    if (draft?.windowId !== undefined)
      await saveCaptureDraft(id, { ...draft, outcome });
    else if (draft) await removeCaptureDraft(id);
    sessions.delete(id);
    return outcome;
  }

  async function abortStage(record: Fallback) {
    if (!record.handoffId) return true;
    let receipt: HandoffReceipt | null | undefined;
    try {
      receipt = await resolveBrowserHandoff(
        record.origin,
        record.handoffId,
        'abort',
      );
    } catch {
      receipt = await readBrowserHandoff(record.origin, record.handoffId).catch(
        ignore,
      );
    }
    if (receipt === undefined || receipt?.state === 'staged') return false;
    return receipt !== null || Date.now() >= (record.checkUntil ?? 0);
  }

  async function restore(id: string, record: Fallback) {
    let disposition = record.browser;
    if (disposition === 'restore') {
      try {
        const item = await findBrowserDownload(record);
        disposition =
          item &&
          (item.state === 'complete' ||
            (item.state === 'in_progress' && !item.paused) ||
            (item.paused &&
              item.canResume &&
              (await resumeBrowserDownload(item))))
            ? 'restored'
            : 'recovery';
      } catch {
        disposition = 'recovery';
      }
      record = { ...record, browser: disposition };
      await saveCapture(id, record);
    }

    const outcome = await finish(
      id,
      disposition === 'restored' ? inBrowser : recovery,
    );
    if (await abortStage(record)) {
      if (disposition === 'recovery') {
        const { browserId, startedAt, origin } = record;
        await saveCapture(id, {
          browserId,
          startedAt,
          origin,
          phase: 'recovery',
        });
      } else await removeCapture(id);
    }
    return outcome;
  }

  async function fallback(
    id: string,
    record: CaptureRecord,
    uncertainStage = false,
    browserState: Fallback['browser'] = 'restore',
  ) {
    const { browserId, startedAt, origin } = record;
    const next: Fallback = {
      browserId,
      startedAt,
      origin,
      phase: 'fallback',
      browser: browserState,
      handoffId: 'handoffId' in record ? record.handoffId : undefined,
      checkUntil: uncertainStage ? Date.now() + 60_000 : undefined,
    };
    await saveCapture(id, next);
    return restore(id, next);
  }

  async function committed(id: string, record: Submission, downloadId: number) {
    if (record.suppress) {
      await updateSettings({ capture: { askBeforeDownloading: false } });
    }
    const outcome = await finish(id, { state: 'committed', downloadId });
    await removeCapture(id);
    return outcome;
  }

  async function commit(id: string, record: Submission) {
    let receipt: HandoffReceipt | null | undefined;
    try {
      receipt = await resolveBrowserHandoff(
        record.origin,
        record.handoffId,
        'commit',
      );
    } catch (error) {
      receipt = await readBrowserHandoff(record.origin, record.handoffId).catch(
        ignore,
      );
      if (receipt?.state === 'staged') {
        // A lost response is checked before retrying the same UUID.
        if (!isHandoffRejection(error)) return pending;
        return fallback(id, record, false, 'recovery');
      }
      if (receipt === undefined) return pending;
    }
    if (receipt?.state === 'committed')
      return committed(id, record, receipt.download_id);
    return receipt?.state === 'staged'
      ? pending
      : fallback(id, record, false, 'recovery');
  }

  async function cancelOriginal(id: string, record: Submission) {
    const item = await findBrowserDownload(record).catch(ignore);
    if (!item) {
      // Lost downloads access is recoverable when permission is granted again.
      if (!(await browser.permissions.contains({ permissions: ['downloads'] })))
        return pending;
      return fallback(id, record, false, 'recovery');
    }
    if (record.phase === 'canceling' && canceledDownload(item)) {
      const next = { ...record, phase: 'commit' } as const;
      await saveCapture(id, next);
      return commit(id, next);
    }
    if (!safelyPaused(item)) return fallback(id, record);
    const next = { ...record, phase: 'canceling' } as const;
    await saveCapture(id, next);
    try {
      await browser.downloads.cancel(item.id);
    } catch {
      return fallback(id, next);
    }
    let after;
    try {
      after = await findBrowserDownload(next);
    } catch {
      return pending;
    }
    if (!canceledDownload(after)) return fallback(id, next);
    const committing = { ...next, phase: 'commit' } as const;
    await saveCapture(id, committing);
    return commit(id, committing);
  }

  async function recoverSubmission(id: string, record: Submission) {
    const receipt = await readBrowserHandoff(
      record.origin,
      record.handoffId,
    ).catch(ignore);
    if (receipt === undefined) {
      // Until a stage is confirmed, leave the original with the browser.
      return record.phase === 'staging' ? fallback(id, record, true) : pending;
    }
    if (receipt?.state === 'committed')
      return committed(id, record, receipt.download_id);
    if (receipt?.state === 'staged')
      return record.phase === 'commit'
        ? commit(id, record)
        : cancelOriginal(id, record);
    return fallback(id, record, record.phase === 'staging' && receipt === null);
  }

  function openWindow(id: string, draft: CaptureDraft) {
    const launch = async () => {
      const popup = await browser.windows
        .create({
          type: 'popup',
          url: windowUrl(id),
          focused: true,
          width: 500,
          height: 600,
        })
        .catch(ignore);
      if (popup?.id === undefined) return;
      try {
        await saveCaptureDraft(id, { ...draft, windowId: popup.id });
      } catch (error) {
        await browser.windows.remove(popup.id).catch(ignore);
        throw error;
      }
    };
    const opened = launch().finally(() => opening.delete(id));
    opening.set(id, opened);
    return opened;
  }

  async function prompt(
    id: string,
    record: CaptureRecord,
    draft: CaptureDraft,
  ) {
    await saveCaptureDraft(id, { ...draft, outcome: draftOutcome });
    const { browserId, startedAt, origin } = record;
    await saveCapture(id, { browserId, startedAt, origin, phase: 'awaiting' });
    await openWindow(id, draft);
    return draftOutcome;
  }

  async function stage(
    id: string,
    record: CaptureRecord,
    draft: CaptureDraft,
    options: ImportOptions,
    suppress: boolean,
    automatic: boolean,
  ) {
    const current = await readSettings();
    const session = sessions.get(id);
    if (
      !current.capture.enabled ||
      current.connection.origin !== record.origin ||
      !(await permissionGranted()) ||
      (draft.session && (!session || !current.capture.useBrowserSession))
    )
      return fallback(id, record);
    if (!safelyPaused(await findBrowserDownload(record).catch(ignore)))
      return fallback(id, record);

    const { browserId, startedAt, origin } = record;
    const submission: Submission = {
      browserId,
      startedAt,
      origin,
      phase: 'staging',
      handoffId: crypto.randomUUID(),
      suppress,
    };
    await saveCapture(id, submission);
    let receipt;
    try {
      receipt = await stageBrowserHandoff(
        origin,
        submission.handoffId,
        draft.url,
        options,
        draft.session ? session : undefined,
        draft.fileName,
      );
    } catch (error) {
      if (!isHandoffRejection(error)) return recoverSubmission(id, submission);
      if (automatic) {
        const queues = await requestDaemon(
          origin,
          '/queues',
          z.array(queueSchema),
        ).catch(ignore);
        if (queues && !queues.some(({ id }) => id === options.queue_id))
          return prompt(id, record, draft);
        return fallback(id, record);
      }
      await saveCapture(id, {
        browserId,
        startedAt,
        origin,
        phase: 'awaiting',
      });
      throw error;
    }
    if (receipt.state === 'committed')
      return committed(id, submission, receipt.download_id);
    if (receipt.state !== 'staged') return fallback(id, submission);
    sessions.delete(id);
    return cancelOriginal(id, submission);
  }

  async function intercept(item: Browser.downloads.DownloadItem) {
    if (!eligibleDownload(item) || !Number.isFinite(Date.parse(item.startTime)))
      return;
    const identity = { browserId: item.id, startedAt: item.startTime };
    const key = JSON.stringify(identity);
    if (preparing.has(key)) return;
    preparing.add(key);
    try {
      // Some browser downloads events arrive just before the response event.
      await delay(120);
      const observed = observer.match(item);
      if (!observed) return;
      const {
        capture,
        connection: { origin },
      } = await readSettings();
      if (
        !capture.enabled ||
        !(await permissionGranted()) ||
        (observed.session.cookie && !capture.useBrowserSession)
      )
        return;
      const id = crypto.randomUUID();
      await run(id, async () => {
        const original = await findPausableDownload(identity);
        if (!original) return inBrowser;
        const beforePause = await readSettings();
        if (
          !beforePause.capture.enabled ||
          beforePause.connection.origin !== origin ||
          (observed.session.cookie && !beforePause.capture.useBrowserSession) ||
          !(await permissionGranted())
        )
          return inBrowser;
        const record = { ...identity, origin, phase: 'pausing' } as const;
        await saveCapture(id, record);
        await refreshStatus();
        try {
          await browser.downloads.pause(original.id);
        } catch {
          return fallback(id, record);
        }
        let draft: CaptureDraft;
        let automatic = false;
        try {
          const paused = await findBrowserDownload(record);
          if (!safelyPaused(paused)) return fallback(id, record);
          const capabilities = await readBrowserCapabilities(origin);
          const useSession =
            capture.useBrowserSession &&
            Boolean(observed.session.cookie || observed.session.referrer);
          if (
            !supportsBrowserHandoff(capabilities) ||
            (useSession && !capabilities?.http_session)
          )
            return fallback(id, record);
          const latest = await readSettings();
          if (
            !latest.capture.enabled ||
            latest.connection.origin !== origin ||
            !(await permissionGranted()) ||
            (useSession && !latest.capture.useBrowserSession)
          )
            return fallback(id, record);
          const preferences = latest.capture;
          const options = {
            queue_id: preferences.defaultQueueId,
            finetune_override: preferences.fineTuneOverride,
            start_immediately: preferences.startImmediately,
          };
          draft = {
            origin,
            options,
            url: observed.url,
            fileName: suggestedFilename(paused.filename),
            totalBytes: paused.totalBytes > 0 ? paused.totalBytes : undefined,
            session: useSession,
            automatic: !preferences.askBeforeDownloading,
            outcome: draftOutcome,
          };
          if (useSession) sessions.set(id, observed.session);
          if (!preferences.askBeforeDownloading) {
            const queues = await requestDaemon(
              origin,
              '/queues',
              z.array(queueSchema),
            );
            automatic = queues.some(({ id }) => id === options.queue_id);
          }
        } catch {
          return fallback(id, record);
        }
        return automatic
          ? stage(id, record, draft, draft.options, false, true)
          : prompt(id, record, draft);
      });
    } finally {
      preparing.delete(key);
    }
  }

  async function ownedDraft(id: string, sender: Browser.runtime.MessageSender) {
    if (
      sender.tab?.windowId === undefined ||
      (sender.url !== windowUrl(id) &&
        sender.url !== browser.runtime.getURL(confirmationPage))
    )
      return;
    await opening.get(id);
    const draft = await readCaptureDraft(id);
    return sender.tab.windowId === draft?.windowId ? draft : undefined;
  }

  async function get(
    id: string,
    sender: Browser.runtime.MessageSender,
  ): Promise<ConfirmationDraft | null> {
    const draft = await ownedDraft(id, sender);
    if (!draft) return null;
    const record = await readCapture(id);
    const outcome =
      draft.outcome.state === 'draft' && record && record.phase !== 'awaiting'
        ? pending
        : draft.outcome;
    const { url, origin, options, fileName, totalBytes, session, automatic } =
      draft;
    return {
      id,
      url,
      origin,
      outcome,
      sessionHost: null,
      capture: { options, fileName, totalBytes, session, automatic },
    };
  }

  async function submit(
    id: string,
    options: ImportOptions,
    suppress: boolean,
    sender: Browser.runtime.MessageSender,
  ) {
    const draft = await ownedDraft(id, sender);
    if (!draft) throw captureError('This confirmation has expired.');
    return run(id, async () => {
      const record = await readCapture(id);
      if (draft.outcome.state !== 'draft' || !record)
        return (await readCaptureDraft(id))?.outcome ?? inBrowser;
      if (record.phase === 'awaiting')
        return stage(id, record, draft, options, suppress, false);
      return reconcileOne(id, record);
    });
  }

  async function reconcileOne(
    id: string,
    record: CaptureRecord,
    windows?: Set<number | undefined>,
  ): Promise<ConfirmationOutcome> {
    switch (record.phase) {
      case 'pausing':
        return fallback(id, record);
      case 'awaiting': {
        const draft = await readCaptureDraft(id);
        const { capture, connection } = await readSettings();
        if (
          !draft ||
          !capture.enabled ||
          connection.origin !== record.origin ||
          (draft.session &&
            (!capture.useBrowserSession || !sessions.has(id))) ||
          (draft.windowId !== undefined &&
            windows &&
            !windows.has(draft.windowId)) ||
          !(await permissionGranted())
        )
          return fallback(id, record);
        return draftOutcome;
      }
      case 'staging':
      case 'canceling':
      case 'commit':
        return recoverSubmission(id, record);
      case 'fallback':
        return restore(id, record);
      case 'recovery':
        return recovery;
    }
  }

  async function check(id: string, sender?: Browser.runtime.MessageSender) {
    if (sender && !(await ownedDraft(id, sender)))
      throw captureError('This confirmation has expired.');
    return run(id, async () => {
      const record = await readCapture(id);
      return record
        ? reconcileOne(id, record)
        : ((await readCaptureDraft(id))?.outcome ?? inBrowser);
    });
  }

  async function keep(id: string, sender?: Browser.runtime.MessageSender) {
    if (sender && !(await ownedDraft(id, sender)))
      throw captureError('This confirmation has expired.');
    return run(id, async () => {
      const record = await readCapture(id);
      if (!record) return (await readCaptureDraft(id))?.outcome ?? inBrowser;
      if (record.phase !== 'awaiting') return reconcileOne(id, record);
      return fallback(id, record);
    });
  }

  async function reopen(id: string) {
    await run(id, async () => {
      const record = await readCapture(id);
      const draft = await readCaptureDraft(id);
      if (record?.phase !== 'awaiting' || !draft) return inBrowser;
      const outcome = await reconcileOne(id, record);
      if (outcome.state !== 'draft') return outcome;
      if (draft.windowId === undefined) await openWindow(id, draft);
      else await browser.windows.update(draft.windowId, { focused: true });
      if ((await readCaptureDraft(id))?.windowId === undefined)
        throw captureError(
          'Could not open the confirmation window. Try again or keep the download in your browser.',
        );
      return outcome;
    });
  }

  async function retryBrowser(id: string) {
    return run(id, async () => {
      const record = await readCapture(id);
      if (record?.phase === 'fallback' && record.browser === 'recovery') {
        const next = { ...record, browser: 'restore' } as const;
        await saveCapture(id, next);
        return restore(id, next);
      }
      return record?.phase === 'recovery' ? fallback(id, record) : inBrowser;
    });
  }

  async function dismiss(id: string) {
    await run(id, async () => {
      if ((await readCapture(id))?.phase === 'recovery')
        await removeCapture(id);
      return recovery;
    });
  }

  async function reconcile() {
    const captures = await listCaptures();
    if (captures.length) {
      const windows = new Set(
        (await browser.windows.getAll()).map(({ id }) => id),
      );
      await Promise.allSettled(
        captures.map(({ id }) => {
          if (operations.has(id)) return;
          return run(id, async () => {
            const record = await readCapture(id);
            return record ? reconcileOne(id, record, windows) : inBrowser;
          });
        }),
      );
    }
    await refreshStatus();
  }

  let createdApi: typeof browser.downloads | undefined;
  const onCreated = (item: Browser.downloads.DownloadItem) => {
    void intercept(item).catch(ignore);
  };
  function attach(ready?: Promise<boolean>) {
    observer.attach(ready);
    const api = browser.downloads;
    if (!api || createdApi) return;
    api.onCreated.addListener(onCreated);
    createdApi = api;
  }
  function detach() {
    observer.detach();
    const api = createdApi;
    createdApi = undefined;
    try {
      api?.onCreated.removeListener(onCreated);
    } catch {
      // The browser may already have withdrawn the downloads event API.
    }
  }

  function refreshListeners() {
    listenerUpdate = listenerUpdate
      .catch(ignore)
      .then(async () => {
        const { capture } = await readSettings();
        const enabled = capture.enabled && (await permissionGranted());
        if (enabled) attach();
        else detach();
        return enabled;
      })
      .catch((error: unknown) => {
        detach();
        throw error;
      });
    return listenerUpdate;
  }

  async function setEnabled(enabled: boolean) {
    const saved = await updateSettings({ capture: { enabled } });
    await refreshListeners();
    await reconcile();
    return saved;
  }

  async function savePreferences(patch: CaptureSettingsPatch) {
    return updateSettings({ capture: patch });
  }

  function register() {
    // Register synchronously so the first request can wake the Chrome worker.
    const ready = refreshListeners();
    attach(ready.catch(() => false));
    void ready.then(reconcile).catch(ignore);
    const refresh = () => void refreshListeners().then(reconcile).catch(ignore);
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    browser.runtime.onStartup.addListener(refresh);
    browser.alarms.onAlarm.addListener(({ name }) => {
      if (name === alarmName) void reconcile().catch(ignore);
    });
    browser.windows.onRemoved.addListener((windowId) => {
      void Promise.allSettled(opening.values())
        .then(async () => {
          for (const { id, draft } of await listCaptureDrafts()) {
            if (draft.windowId !== windowId) continue;
            await operations.get(id)?.catch(ignore);
            if ((await readCapture(id))?.phase === 'awaiting') await keep(id);
            await removeCaptureDraft(id);
          }
        })
        .catch(ignore);
    });
    watchSettings(() => void reconcile().catch(ignore));
  }

  return {
    register,
    get,
    submit,
    check,
    keep,
    reopen,
    list,
    dismiss,
    retryBrowser,
    setEnabled,
    savePreferences,
    reconcile,
    intercept,
  };
}
