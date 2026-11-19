import { useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FineTuneFields } from '@/features/downloads/fine-tune-fields';
import { daemonKeys, useQueue } from '@/shared/api/queries';
import { writeQueue } from '@/shared/browser/messages';
import { ArioError } from '@/shared/types/connection';
import type { DownloadLiveStatus, Queue } from '@/shared/types/daemon';
import {
  queueDownloads,
  queueSettingsSnapshot,
} from '@/shared/types/queue-workflows';
import { Button } from '@/shared/ui/button';
import {
  buildQueueSettings,
  queueDraft,
  type QueueTab,
} from './queue-editor-model';
import { QueueEvents } from './queue-events';
import { QueueItems, type StagedOrder } from './queue-items';
import { QueueSchedule } from './queue-schedule';
import { QueueScreen } from './queue-screen';

const tabs = {
  general: 'General',
  schedule: 'Schedule',
  events: 'Events',
  downloads: 'Download Items',
};

type EditorProps = {
  origin: string;
  id: number | null;
  visible: boolean;
  unavailable: boolean;
  downloads?: DownloadLiveStatus[];
  downloadsUnavailable: boolean;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
};

export function QueueEditor(props: EditorProps) {
  const detail = useQueue(props.origin, props.id, props.visible);
  if (props.id !== null && !detail.data) {
    return (
      <QueueScreen
        backLabel={props.backLabel}
        onBack={props.onBack}
        onClose={props.onClose}
      >
        <main className="queue-pane">
          <div className="queue-content">
            <h1>Edit queue</h1>
            {detail.error ? (
              <div className="mt-3">
                <p role="alert" className="mb-2 text-xs text-destructive">
                  {detail.error.message}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={detail.isFetching}
                  onClick={() => void detail.refetch()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <p role="status" className="mt-2 text-xs text-muted-foreground">
                Loading queue settings…
              </p>
            )}
          </div>
        </main>
      </QueueScreen>
    );
  }
  return (
    <QueueForm
      {...props}
      queue={detail.data}
      unavailable={props.unavailable || detail.isError}
    />
  );
}

function QueueForm({
  origin,
  id,
  queue,
  downloads,
  downloadsUnavailable,
  unavailable,
  backLabel,
  onBack,
  onClose,
  onSaved,
}: EditorProps & { queue?: Queue }) {
  const client = useQueryClient();
  const [source, setSource] = useState(queue);
  const [draft, setDraft] = useState(() => queueDraft(queue));
  const [staged, setStaged] = useState<StagedOrder>();
  const [tab, setTab] = useState<QueueTab>('general');
  const [busy, setBusy] = useState(false);
  const [creationUncertain, setCreationUncertain] = useState(false);
  const [issue, setIssue] = useState<{ message: string; partial?: boolean }>();
  const heading = useRef<HTMLHeadingElement>(null);
  const items = useMemo(
    () =>
      downloads && id !== null ? queueDownloads(downloads, id) : undefined,
    [downloads, id],
  );
  const creating = id === null;

  useEffect(() => heading.current?.focus(), []);

  function change(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    if (!issue?.partial && !creationUncertain) setIssue(undefined);
  }

  function changeOrder(order?: StagedOrder) {
    setStaged(order);
    setIssue(undefined);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || unavailable || creationUncertain) return;
    const validation = buildQueueSettings(draft, source?.scheduler.recurrence);
    if ('message' in validation) {
      setIssue(validation);
      setTab(validation.tab);
      return;
    }
    const { settings } = validation;
    setIssue(undefined);
    setBusy(true);
    try {
      if (!source) {
        const created = await writeQueue('daemon.queue.create', {
          origin,
          settings,
        });
        onSaved(`Queue “${created.name}” created.`);
      } else {
        const result = await writeQueue('daemon.queue.update', {
          origin,
          id: source.id,
          expected: queueSettingsSnapshot(source),
          settings,
          order: staged
            ? {
                previous: staged.previous,
                ordered: staged.items.map(({ download }) => download.id),
              }
            : undefined,
        });
        if (result.orderError) {
          setSource(result.queue);
          setTab('downloads');
          setIssue({
            message: `Queue settings saved. Download order could not be saved. ${result.orderError}`,
            partial: true,
          });
        } else {
          onSaved('Queue changes saved.');
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save the queue.';
      const rejected =
        error instanceof ArioError &&
        error.detail.kind === 'http' &&
        error.detail.status !== undefined &&
        error.detail.status < 500;
      if (creating && !rejected) {
        setCreationUncertain(true);
        setIssue({
          message: `Could not confirm whether the queue was created. Check Manage queues before trying again. ${message}`,
        });
      } else {
        setIssue({ message });
      }
    } finally {
      await client.invalidateQueries({ queryKey: daemonKeys.origin(origin) });
      setBusy(false);
    }
  }

  return (
    <QueueScreen
      backLabel={backLabel}
      onBack={onBack}
      onClose={onClose}
      busy={busy}
    >
      <main className="queue-pane" aria-label="Queue editor">
        <div className="queue-content">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h1
                ref={heading}
                tabIndex={-1}
                className="wrap-anywhere outline-none"
              >
                {creating ? 'Create queue' : source?.name}
              </h1>
              {creating && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Set the defaults and schedule for this queue.
                </p>
              )}
            </div>
            {queue && (
              <span className="queue-badge">
                {queue.scheduler.enabled && (
                  <Clock3 className="size-3" aria-hidden="true" />
                )}
                {queue.scheduler.enabled
                  ? `Scheduled · ${queue.status}`
                  : queue.status}
              </span>
            )}
          </div>
          <form
            id="queue-form"
            onSubmit={(event) => void save(event)}
            noValidate
          >
            <Tabs.Root
              value={tab}
              onValueChange={(value) => setTab(value as QueueTab)}
            >
              <Tabs.List
                className="queue-tabs"
                aria-label="Queue settings sections"
              >
                {Object.entries(tabs).map(([value, label]) => (
                  <Tabs.Trigger key={value} value={value} type="button">
                    {label}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Tabs.Content value="general">
                <fieldset disabled={busy} className="queue-form-grid">
                  <label className="workflow-field col-span-full">
                    Queue name
                    <input
                      required
                      value={draft.name}
                      onChange={(event) => change({ name: event.target.value })}
                    />
                  </label>
                  <label className="workflow-field">
                    Concurrent downloads
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      required
                      value={draft.concurrency}
                      onChange={(event) =>
                        change({ concurrency: event.target.value })
                      }
                    />
                  </label>
                  <label className="workflow-field">
                    Maximum retries
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      required
                      value={draft.retries}
                      onChange={(event) =>
                        change({ retries: event.target.value })
                      }
                    />
                  </label>
                  <label className="workflow-field">
                    Retry delay (seconds)
                    <input
                      inputMode="numeric"
                      maxLength={10}
                      required
                      value={draft.delay}
                      onChange={(event) =>
                        change({ delay: event.target.value })
                      }
                    />
                  </label>
                  <div className="col-span-full border-t border-border pt-3">
                    <h2 className="mb-3 text-[11px] font-medium text-muted-foreground">
                      Download defaults
                    </h2>
                    <FineTuneFields
                      queueDefaults
                      value={draft.fineTune}
                      onChange={(fineTune) => change({ fineTune })}
                    />
                  </div>
                </fieldset>
              </Tabs.Content>
              <Tabs.Content value="schedule">
                <fieldset disabled={busy}>
                  <QueueSchedule
                    draft={draft.schedule}
                    scheduledStop={queue?.scheduled_stop_at ?? null}
                    onChange={(patch) =>
                      change({ schedule: { ...draft.schedule, ...patch } })
                    }
                  />
                </fieldset>
              </Tabs.Content>
              <Tabs.Content value="events">
                <fieldset disabled={busy}>
                  <QueueEvents
                    queue={queue}
                    successCommand={draft.successCommand}
                    stopCommand={draft.stopCommand}
                    onSuccessChange={(successCommand) =>
                      change({ successCommand })
                    }
                    onStopChange={(stopCommand) => change({ stopCommand })}
                  />
                </fieldset>
              </Tabs.Content>
              <Tabs.Content value="downloads">
                <fieldset disabled={busy}>
                  <QueueItems
                    items={items}
                    staged={staged}
                    onChange={changeOrder}
                    unavailable={unavailable || downloadsUnavailable}
                    creating={creating}
                  />
                </fieldset>
              </Tabs.Content>
            </Tabs.Root>
          </form>
        </div>
      </main>
      <footer className="queue-footer">
        <div>
          {issue && (
            <p
              role="alert"
              className="w-full text-[11px] text-destructive wrap-anywhere"
            >
              {issue.message}
            </p>
          )}
          {unavailable && (
            <p
              role="status"
              className="w-full text-[11px] text-muted-foreground"
            >
              Queue settings are unavailable. Reconnecting…
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="queue-form"
            disabled={busy || unavailable || creationUncertain}
          >
            {busy ? 'Saving…' : creating ? 'Create queue' : 'Save changes'}
          </Button>
        </div>
      </footer>
    </QueueScreen>
  );
}
