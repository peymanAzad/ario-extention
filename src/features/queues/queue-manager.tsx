import { useQueryClient } from '@tanstack/react-query';
import { Clock3, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { WorkflowDialog } from '@/features/downloads/workflow-dialog';
import { daemonKeys } from '@/shared/api/queries';
import { writeQueue } from '@/shared/browser/messages';
import type { Queue } from '@/shared/types/daemon';
import { mainQueueId } from '@/shared/types/queue-workflows';
import { Button } from '@/shared/ui/button';
import { QueueScreen } from './queue-screen';

export function QueueManager({
  origin,
  queues,
  unavailable,
  onClose,
  onEdit,
  onCreate,
}: {
  origin: string;
  queues: Queue[];
  unavailable: boolean;
  onClose: () => void;
  onEdit: (id: number) => void;
  onCreate: () => void;
}) {
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Queue>();
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();

  useEffect(() => heading.current?.focus(), []);

  async function act(
    queue: Queue,
    action: 'toggle' | 'delete' | 'confirm-delete',
  ) {
    if (busy || unavailable) return;
    setNotice(undefined);
    setBusy(true);
    try {
      if (action === 'toggle') {
        const result = await writeQueue('daemon.queue.action', {
          origin,
          id: queue.id,
          status: queue.status,
        });
        const message =
          result === 'nothing-to-start'
            ? 'Nothing to start. This queue has no pending or paused downloads.'
            : queue.status === 'Active'
              ? 'Queue paused.'
              : 'Queue started.';
        setNotice({ message });
      } else {
        const result = await writeQueue('daemon.queue.delete', {
          origin,
          id: queue.id,
          confirmed: action === 'confirm-delete',
        });
        if (result === 'needs-confirmation') {
          setConfirmation(queue);
        } else {
          setConfirmation(undefined);
          setNotice({ message: `Queue “${queue.name}” deleted.` });
          heading.current?.focus();
        }
      }
    } catch (error) {
      setNotice({
        message:
          error instanceof Error ? error.message : 'The queue request failed.',
        error: true,
      });
    } finally {
      await client.invalidateQueries({ queryKey: daemonKeys.origin(origin) });
      setBusy(false);
    }
  }

  return (
    <QueueScreen
      backLabel="Back to downloads"
      onBack={onClose}
      onClose={onClose}
      busy={busy}
    >
      <main className="queue-pane" aria-label="Manage queues">
        <div className="queue-content">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h1 ref={heading} tabIndex={-1} className="outline-none">
              Manage queues
            </h1>
            <Button
              type="button"
              onClick={onCreate}
              disabled={unavailable || busy}
            >
              <Plus aria-hidden="true" />
              Create queue
            </Button>
          </div>
          {unavailable && (
            <p role="status" className="mb-2 text-xs text-muted-foreground">
              Queue controls are unavailable. Reconnecting…
            </p>
          )}
          {notice && !confirmation && (
            <p
              role={notice.error ? 'alert' : 'status'}
              className={`mb-2 text-xs wrap-anywhere ${notice.error ? 'text-destructive' : 'text-primary'}`}
            >
              {notice.message}
            </p>
          )}
          <ul>
            {queues.map((queue) => {
              const active = queue.status === 'Active';
              const ActionIcon = active ? Pause : Play;
              return (
                <li key={queue.id} className="queue-item flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium wrap-anywhere">{queue.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      {queue.scheduler.enabled && (
                        <Clock3 className="size-3" aria-hidden="true" />
                      )}
                      {queue.scheduler.enabled
                        ? `Scheduled · ${queue.status}`
                        : queue.status}
                    </p>
                  </div>
                  <div className="flex shrink-0">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${queue.name}`}
                      title="Edit queue"
                      disabled={busy || unavailable}
                      onClick={() => onEdit(queue.id)}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${active ? 'Pause' : 'Start'} ${queue.name}`}
                      title={active ? 'Pause queue' : 'Start queue'}
                      disabled={busy || unavailable}
                      onClick={() => void act(queue, 'toggle')}
                    >
                      <ActionIcon aria-hidden="true" />
                    </Button>
                    {queue.id !== mainQueueId && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${queue.name}`}
                        title="Delete queue"
                        disabled={busy || unavailable}
                        onClick={() => void act(queue, 'delete')}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </main>
      {confirmation && (
        <WorkflowDialog
          title="Delete queue and download records?"
          description={`Delete “${confirmation.name}” and all its download records. Downloaded files will be kept.`}
          busy={busy}
          onClose={() => {
            setConfirmation(undefined);
            setNotice(undefined);
          }}
        >
          {notice?.error && (
            <p role="alert" className="text-xs text-destructive wrap-anywhere">
              {notice.message}
            </p>
          )}
          <div className="workflow-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setConfirmation(undefined);
                setNotice(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-destructive text-background"
              disabled={busy || unavailable}
              onClick={() => void act(confirmation, 'confirm-delete')}
            >
              {busy ? 'Deleting…' : 'Delete queue'}
            </Button>
          </div>
        </WorkflowDialog>
      )}
    </QueueScreen>
  );
}
