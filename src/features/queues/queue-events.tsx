import { Terminal } from 'lucide-react';
import type { Queue } from '@/shared/types/daemon';

const statusLabels = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

type EventResult = Queue['event_results']['on_success'];

export function QueueEvents({
  successCommand,
  stopCommand,
  onSuccessChange,
  onStopChange,
  queue,
}: {
  successCommand: string;
  stopCommand: string;
  onSuccessChange: (value: string) => void;
  onStopChange: (value: string) => void;
  queue?: Queue;
}) {
  return (
    <div className="grid gap-4">
      <label className="workflow-field">
        When all downloads succeed
        <input
          value={successCommand}
          onChange={(event) => onSuccessChange(event.target.value)}
        />
      </label>
      <label className="workflow-field">
        When the queue stops automatically
        <input
          value={stopCommand}
          onChange={(event) => onStopChange(event.target.value)}
        />
      </label>
      <div className="queue-hint">
        <Terminal aria-hidden="true" />
        <p>
          Commands run on the daemon computer with the daemon user’s
          permissions. Leave a field blank to disable its command.
        </p>
      </div>
      {queue && (
        <section aria-label="Latest command results">
          <h2 className="mb-2 text-xs font-semibold">Latest runs</h2>
          <EventResultRow
            label="On success"
            result={queue.event_results.on_success}
            configured={Boolean(queue.settings.on_success_command)}
          />
          <EventResultRow
            label="On automatic stop"
            result={queue.event_results.on_stop}
            configured={Boolean(queue.settings.on_stop_command)}
          />
        </section>
      )}
    </div>
  );
}

function EventResultRow({
  label,
  result,
  configured,
}: {
  label: string;
  result: EventResult;
  configured: boolean;
}) {
  const timestamps = [
    ['Queued', result?.queued_at],
    ['Started', result?.started_at],
    ['Finished', result?.finished_at],
  ] as const;
  return (
    <div className="border-t border-border py-2.5 text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h3 className="font-medium">{label}</h3>
        {result ? (
          <span className="queue-badge">{statusLabels[result.status]}</span>
        ) : (
          <span className="text-muted-foreground">
            {configured ? 'No runs yet' : 'No command configured'}
          </span>
        )}
      </div>
      {result && (
        <div className="mt-1.5 space-y-1 text-muted-foreground">
          {timestamps.map(
            ([name, value]) =>
              value && (
                <p key={name}>
                  {name}{' '}
                  <time dateTime={value}>
                    {new Date(value).toLocaleString()}
                  </time>
                </p>
              ),
          )}
          {result.exit_code !== null && <p>Exit code {result.exit_code}</p>}
          {result.message && <p className="wrap-anywhere">{result.message}</p>}
        </div>
      )}
    </div>
  );
}
