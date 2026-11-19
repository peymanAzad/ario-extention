import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  Layers,
  ListFilter,
  Plus,
  Search,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  daemonKeys,
  useDaemonHealth,
  useDownloads,
  useQueues,
} from '@/shared/api/queries';
import { writeDownload } from '@/shared/browser/messages';
import type { DownloadLiveStatus } from '@/shared/types/daemon';
import { ConnectionStatus } from '@/features/connection/connection-status';
import { QueueEditor } from '@/features/queues/queue-editor';
import { QueueManager } from '@/features/queues/queue-manager';
import { useExtensionSettings } from '@/features/settings/settings-context';
import { openOptions } from '@/shared/browser/runtime';
import {
  categories,
  statuses,
  type DashboardFilters,
} from '@/shared/types/dashboard';
import { Button } from '@/shared/ui/button';
import { AppHeader } from '@/shared/ui/shell';
import {
  categoryLabels,
  downloadName,
  formatBytes,
  proxyStatus,
  selectDownloads,
  statusKey,
  statusLabels,
} from './dashboard-model';
import { CaptureNotices } from './capture-notices';
import { useDashboardFilters, usePageVisible } from './dashboard-state';
import { categoryIcons, DownloadList } from './download-list';
import { AddDownloadDialog } from './add-download-dialog';
import { ClearCompletedDialog } from './clear-completed-dialog';
import { DownloadDetailsDialog } from './download-details-dialog';
import { workflowError } from './workflow-model';

type Workflow =
  | { name: 'add'; initialQueueId: number | null }
  | { name: 'details'; id: number; filename: string }
  | { name: 'clear'; queueId: number | null; queueName: string };

type QueueView =
  | { name: 'manage' }
  | { name: 'editor'; id: number | null; fromManager: boolean };

export function Popup() {
  const { settings, ready, loadFailed } = useExtensionSettings();
  return (
    <Dashboard
      key={settings.connection.origin}
      origin={settings.connection.origin}
      ready={ready}
      loadFailed={loadFailed}
    />
  );
}

function Dashboard({
  origin,
  ready,
  loadFailed,
}: {
  origin: string;
  ready: boolean;
  loadFailed: boolean;
}) {
  const queryClient = useQueryClient();
  const visible = usePageVisible();
  const enabled = ready && visible;
  const health = useDaemonHealth(origin, enabled, true);
  const downloads = useDownloads(origin, enabled);
  const queues = useQueues(origin, enabled);
  const dashboard = useDashboardFilters();
  const { filters, update, ready: filtersReady } = dashboard;
  const [settingsError, setSettingsError] = useState(false);
  const [workflow, setWorkflow] = useState<Workflow>();
  const [queueView, setQueueView] = useState<QueueView>();
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();
  const [acting, setActing] = useState(new Set<number>());
  const actionLocks = useRef(new Set<number>());
  const [pausing, setPausing] = useState(new Map<number, string | null>());

  useEffect(() => {
    if (!downloads.data || pausing.size === 0) return;
    const stillPausing = new Map<number, string | null>();
    for (const { download } of downloads.data) {
      if (
        download.status === 'Active' &&
        pausing.get(download.id) === download.aria2_gid
      ) {
        stillPausing.set(download.id, download.aria2_gid);
      }
    }
    if (stillPausing.size < pausing.size) setPausing(stillPausing);
  }, [downloads.data, pausing]);

  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = window.setTimeout(() => setNotice(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const sortedQueues = useMemo(
    () =>
      [...(queues.data ?? [])].sort(
        (a, b) => a.position - b.position || a.id - b.id,
      ),
    [queues.data],
  );
  const missingQueue =
    filtersReady &&
    queues.data !== undefined &&
    filters.queueId !== null &&
    !queues.data.some((queue) => queue.id === filters.queueId);
  const effectiveFilters = useMemo(
    () => (missingQueue ? { ...filters, queueId: null } : filters),
    [filters, missingQueue],
  );
  const resetQueue = useCallback(() => update({ queueId: null }), [update]);
  useEffect(() => {
    if (missingQueue) resetQueue();
  }, [missingQueue, resetQueue]);
  const results = useMemo(
    () => selectDownloads(downloads.data ?? [], effectiveFilters),
    [downloads.data, effectiveFilters],
  );
  const selectedQueue = sortedQueues.find(
    (queue) => queue.id === effectiveFilters.queueId,
  );
  const unavailable = !health.data || health.isError;
  const queuesUnavailable = unavailable || !queues.data || queues.isError;
  const canClear =
    !unavailable &&
    !downloads.isError &&
    downloads.data?.some(
      ({ download }) =>
        download.status === 'Completed' &&
        (selectedQueue === undefined || download.queue_id === selectedQueue.id),
    );

  function actionPending(item: DownloadLiveStatus) {
    const { id, status, aria2_gid: gid } = item.download;
    return acting.has(id) || (status === 'Active' && pausing.get(id) === gid);
  }

  async function runAction(item: DownloadLiveStatus) {
    const { id } = item.download;
    if (unavailable || actionPending(item) || actionLocks.current.has(id))
      return;
    actionLocks.current.add(id);
    setActing(new Set(actionLocks.current));
    setNotice(undefined);
    const expectedStatus = statusKey(item);
    try {
      const result = await writeDownload('daemon.download.action', {
        origin,
        id,
        expectedStatus,
      });
      if (expectedStatus === 'Active' && result.download.status === 'Active') {
        setPausing((current) =>
          new Map(current).set(id, result.download.aria2_gid),
        );
      }
    } catch (error) {
      setNotice({ message: workflowError(error), error: true });
    } finally {
      await queryClient.invalidateQueries({
        queryKey: daemonKeys.origin(origin),
      });
      actionLocks.current.delete(id);
      setActing(new Set(actionLocks.current));
    }
  }

  function finish(message: string) {
    setWorkflow(undefined);
    setNotice({ message });
  }

  const errors = [
    health.error && `Connection: ${health.error.message}`,
    downloads.error && `Downloads: ${downloads.error.message}`,
    queues.error && `Queues: ${queues.error.message}`,
  ].filter(Boolean);
  const stale = errors.length > 0 || health.data?.aria2_reachable === false;
  const canReconnect = stale;
  const initialLoading =
    !ready || !filtersReady || (downloads.isPending && !downloads.error);
  const subtitle = downloads.data
    ? `${downloads.data.length} downloads · ${selectedQueue?.name ?? 'All queues'}`
    : initialLoading
      ? 'Loading your downloads…'
      : 'Downloads unavailable';

  async function showSettings() {
    setSettingsError(false);
    try {
      await openOptions();
    } catch {
      setSettingsError(true);
    }
  }
  function reconnect() {
    void health.refetch();
    void downloads.refetch();
    void queues.refetch();
  }
  const categoryCounts = new Map(
    categories.map((category) => [
      category,
      (downloads.data ?? []).filter(
        (item) =>
          item.download.category === category &&
          (effectiveFilters.queueId === null ||
            item.download.queue_id === effectiveFilters.queueId),
      ).length,
    ]),
  );
  const navClass = (selected: boolean) =>
    `dashboard-nav ${selected ? 'bg-accent text-foreground font-medium' : 'text-muted-foreground hover:bg-accent'}`;

  function closeQueues() {
    const directCreate = queueView?.name === 'editor' && !queueView.fromManager;
    setQueueView(undefined);
    window.requestAnimationFrame(() =>
      document
        .getElementById(directCreate ? 'create-queue' : 'manage-queues')
        ?.focus(),
    );
  }

  if (queueView?.name === 'manage') {
    return (
      <QueueManager
        origin={origin}
        queues={sortedQueues}
        unavailable={queuesUnavailable}
        onClose={closeQueues}
        onEdit={(id) => setQueueView({ name: 'editor', id, fromManager: true })}
        onCreate={() =>
          setQueueView({ name: 'editor', id: null, fromManager: true })
        }
      />
    );
  }

  if (queueView?.name === 'editor') {
    return (
      <QueueEditor
        origin={origin}
        id={queueView.id}
        visible={enabled}
        unavailable={queuesUnavailable}
        downloads={downloads.data}
        downloadsUnavailable={downloads.isError}
        backLabel={
          queueView.fromManager
            ? 'Back to queue management'
            : 'Back to downloads'
        }
        onBack={
          queueView.fromManager
            ? () => setQueueView({ name: 'manage' })
            : closeQueues
        }
        onClose={closeQueues}
        onSaved={(message) => {
          closeQueues();
          setNotice({ message });
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2">
          {ready && (
            <ConnectionStatus
              compact
              checking={!health.data && health.isFetching}
              health={health.data}
              error={health.error}
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Open settings"
            onClick={() => void showSettings()}
          >
            <Settings2 aria-hidden="true" />
          </Button>
        </div>
      </AppHeader>
      <div className="dashboard-workspace">
        <aside aria-label="Library" className="dashboard-sidebar">
          <fieldset disabled={!filtersReady} className="min-w-0">
            <legend className="dashboard-section-label">Library</legend>
            <button
              type="button"
              aria-pressed={filters.category === null}
              className={navClass(filters.category === null)}
              onClick={() => update({ category: null })}
            >
              <Layers size={14} aria-hidden="true" />
              <span className="min-w-0 flex-1">All downloads</span>
            </button>
            {categories.map((category) => {
              const Icon = categoryIcons[category];
              return (
                <button
                  type="button"
                  key={category}
                  aria-pressed={filters.category === category}
                  className={navClass(filters.category === category)}
                  onClick={() => update({ category })}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    {categoryLabels[category]}
                  </span>
                  <span className="text-[10px]" aria-hidden="true">
                    {downloads.data ? categoryCounts.get(category) : '—'}
                  </span>
                </button>
              );
            })}
          </fieldset>
          <fieldset disabled={!filtersReady} className="mt-6 min-w-0">
            <legend className="dashboard-section-label w-full">
              <span className="flex items-center justify-between gap-1">
                Queues
                <Button
                  id="create-queue"
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-5 [&_svg]:size-3.5"
                  aria-label="Create queue"
                  disabled={queuesUnavailable}
                  onClick={() => {
                    setNotice(undefined);
                    setQueueView({
                      name: 'editor',
                      id: null,
                      fromManager: false,
                    });
                  }}
                >
                  <Plus aria-hidden="true" />
                </Button>
              </span>
            </legend>
            <button
              type="button"
              aria-pressed={effectiveFilters.queueId === null}
              className={navClass(effectiveFilters.queueId === null)}
              onClick={() => update({ queueId: null })}
            >
              <ListFilter size={14} aria-hidden="true" />
              <span>All queues</span>
            </button>
            {sortedQueues.map((queue) => (
              <button
                type="button"
                key={queue.id}
                aria-pressed={effectiveFilters.queueId === queue.id}
                className={navClass(effectiveFilters.queueId === queue.id)}
                onClick={() => update({ queueId: queue.id })}
                aria-label={`${queue.name} · ${queue.status}`}
                title={`${queue.name} · ${queue.status}`}
              >
                <span
                  aria-hidden="true"
                  className={`mx-1 size-1.5 shrink-0 rounded-[2px] ${queue.status === 'Active' ? 'bg-primary' : 'bg-muted-foreground'}`}
                />
                <span className="min-w-0 flex-1 truncate">{queue.name}</span>
                <span className="sr-only"> · {queue.status}</span>
              </button>
            ))}
            {!queues.data && (
              <p className="px-2 pt-2 text-[10px] text-muted-foreground">
                {queues.error ? 'Queues unavailable' : 'Loading queues…'}
              </p>
            )}
            <button
              id="manage-queues"
              type="button"
              className={navClass(false)}
              disabled={!queues.data}
              onClick={() => {
                setNotice(undefined);
                setQueueView({ name: 'manage' });
              }}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>Manage queues</span>
            </button>
          </fieldset>
        </aside>
        <main className="dashboard-main">
          <CaptureNotices enabled={enabled} />
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h1>Downloads</h1>
              <p
                className="mt-1 truncate text-[11px] text-muted-foreground"
                title={subtitle}
              >
                {subtitle}
              </p>
            </div>
            <Button
              id="add-download"
              type="button"
              disabled={!ready}
              onClick={() => {
                setNotice(undefined);
                setWorkflow({
                  name: 'add',
                  initialQueueId:
                    selectedQueue?.id ??
                    sortedQueues.find((queue) => queue.id === 1)?.id ??
                    sortedQueues[0]?.id ??
                    null,
                });
              }}
            >
              <Plus aria-hidden="true" />
              Add download
            </Button>
          </div>
          {(loadFailed || settingsError || dashboard.storageError) && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {loadFailed
                ? 'Could not read extension settings.'
                : settingsError
                  ? 'Settings could not open. Try again from the toolbar or the browser’s extensions page.'
                  : 'Could not remember dashboard filters. Your current view is still available.'}
            </p>
          )}
          {stale && (
            <div role="status" className="dashboard-outage">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {downloads.data
                    ? 'Live updates interrupted · showing last known data'
                    : 'Live updates unavailable'}
                </p>
                {downloads.data && (
                  <p>
                    Downloads last updated{' '}
                    {new Date(downloads.dataUpdatedAt).toLocaleTimeString()}
                  </p>
                )}
                {health.data?.aria2_reachable === false && (
                  <p>aria2 is unreachable. Download progress may be stale.</p>
                )}
                {errors.map((error) => (
                  <p key={String(error)} className="break-words">
                    {error}
                  </p>
                ))}
              </div>
              {canReconnect && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    health.isFetching ||
                    downloads.isFetching ||
                    queues.isFetching
                  }
                  onClick={reconnect}
                >
                  Reconnect
                </Button>
              )}
            </div>
          )}
          {notice?.error && !workflow && (
            <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-destructive">
              <p role="alert">{notice.message}</p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setNotice(undefined)}
              >
                Dismiss
              </Button>
            </div>
          )}
          <fieldset disabled={!filtersReady} className="dashboard-filters">
            <label className="dashboard-search">
              <Search size={14} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search downloads"
                placeholder="Search downloads…"
                maxLength={2000}
                value={filters.search}
                onChange={(event) => update({ search: event.target.value })}
              />
            </label>
            <select
              aria-label="Filter download status"
              className="dashboard-select"
              value={filters.status ?? ''}
              onChange={(event) =>
                update({
                  status: (event.target.value ||
                    null) as DashboardFilters['status'],
                })
              }
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {statusLabels[status]}
                </option>
              ))}
            </select>
          </fieldset>
          <div className="dashboard-caption">
            <span aria-live="polite">
              {downloads.data ? `${results.length} results` : 'Downloads'}
            </span>
            <div className="flex min-w-0 flex-wrap items-center gap-1">
              {canClear && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-6 px-1.5 text-[10px] tracking-normal normal-case"
                  onClick={() =>
                    setWorkflow({
                      name: 'clear',
                      queueId: selectedQueue?.id ?? null,
                      queueName: selectedQueue?.name ?? 'all queues',
                    })
                  }
                >
                  Clear completed
                </Button>
              )}
              <select
                aria-label="Sort downloads"
                disabled={!filtersReady}
                className="dashboard-sort"
                value={filters.sortBy}
                onChange={(event) =>
                  update({
                    sortBy: event.target.value as DashboardFilters['sortBy'],
                  })
                }
              >
                <option value="CreatedAt">Created</option>
                <option value="Name">Name</option>
                <option value="Size">Size</option>
                <option value="QueuePosition">Queue position</option>
              </select>
              <button
                type="button"
                disabled={!filtersReady}
                aria-label={
                  filters.descending ? 'Sort ascending' : 'Sort descending'
                }
                className="rounded p-1 hover:bg-accent"
                onClick={() => update({ descending: !filters.descending })}
              >
                {filters.descending ? (
                  <ArrowDownWideNarrow size={14} aria-hidden="true" />
                ) : (
                  <ArrowUpWideNarrow size={14} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
          {initialLoading ? (
            <div role="status" className="dashboard-empty">
              Loading downloads…
            </div>
          ) : !downloads.data ? (
            <div className="dashboard-empty">
              Could not load downloads. Reconnect to try again.
            </div>
          ) : results.length === 0 ? (
            <div className="dashboard-empty">
              {downloads.data.length === 0
                ? 'No downloads yet.'
                : 'No downloads match your filters.'}
            </div>
          ) : (
            <DownloadList
              key={JSON.stringify(effectiveFilters)}
              items={results}
              queues={sortedQueues}
              controls={{
                unavailable: unavailable || downloads.isError,
                pending: actionPending,
                onAction: (item) => void runAction(item),
                onDetails: (item) => {
                  setNotice(undefined);
                  setWorkflow({
                    name: 'details',
                    id: item.download.id,
                    filename: downloadName(item),
                  });
                },
              }}
            />
          )}
        </main>
      </div>
      <footer className="dashboard-footer" aria-label="Daemon statistics">
        <span className="flex items-center gap-1 text-primary">
          <ArrowDownToLine size={12} aria-hidden="true" />
          {health.data
            ? `${formatBytes(health.data.download_speed)}/s`
            : '— /s'}
        </span>
        <span>{health.data ? health.data.active_downloads : '—'} active</span>
        <span className="ml-auto">
          {proxyStatus(health.data)}
          {stale && health.data ? ' · last known' : ''}
        </span>
      </footer>
      {notice && !notice.error && !workflow && (
        <p role="status" className="workflow-notice">
          {notice.message}
        </p>
      )}
      {workflow?.name === 'add' && (
        <AddDownloadDialog
          origin={origin}
          queues={sortedQueues}
          initialQueueId={workflow.initialQueueId}
          unavailable={unavailable || queues.isError}
          onClose={() => setWorkflow(undefined)}
          onAdded={finish}
        />
      )}
      {workflow?.name === 'details' && (
        <DownloadDetailsDialog
          origin={origin}
          id={workflow.id}
          name={workflow.filename}
          queues={sortedQueues}
          visible={visible}
          unavailable={unavailable}
          isActionPending={actionPending}
          action={runAction}
          actionError={notice?.error ? notice.message : undefined}
          onClose={() => {
            setWorkflow(undefined);
            setNotice(undefined);
          }}
          onRemoved={finish}
        />
      )}
      {workflow?.name === 'clear' && (
        <ClearCompletedDialog
          origin={origin}
          queueId={workflow.queueId}
          queueName={workflow.queueName}
          unavailable={unavailable}
          onClose={() => setWorkflow(undefined)}
          onCleared={() => finish('Completed records cleared. Files kept.')}
        />
      )}
    </div>
  );
}
