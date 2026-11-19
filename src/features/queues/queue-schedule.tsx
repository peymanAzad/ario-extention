import { Clock3 } from 'lucide-react';
import type { Queue } from '@/shared/types/daemon';
import { weekdays, weeklyTimeKey } from '@/shared/types/queue-workflows';
import type { Repeat, ScheduleDraft } from './queue-editor-model';

const dayNames = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

export function QueueSchedule({
  draft,
  daemonTimezone,
  scheduledStop,
  onChange,
}: {
  draft: ScheduleDraft;
  daemonTimezone?: string | null;
  scheduledStop: Queue['scheduled_stop_at'];
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  const once = draft.repeat === 'once';
  const window = once ? draft.once : draft.weekly;
  const overnight =
    !once &&
    window.start &&
    window.end &&
    weeklyTimeKey(window.end) < weeklyTimeKey(window.start);

  function setBoundary(boundary: 'start' | 'end', value: string) {
    onChange({ [once ? 'once' : 'weekly']: { ...window, [boundary]: value } });
  }

  return (
    <div className="grid gap-4">
      <label className="queue-setting">
        <span>
          <span className="font-medium">Scheduled downloads</span>
          <small>Run this queue during a scheduled window.</small>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Enable queue schedule"
          checked={draft.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
        />
      </label>
      {draft.enabled && (
        <>
          <div className="queue-form-grid">
            <label className="workflow-field col-span-full">
              Repeat
              <select
                value={draft.repeat}
                onChange={(event) =>
                  onChange({ repeat: event.target.value as Repeat })
                }
              >
                <option value="weekly">Weekly</option>
                <option value="daily">Every day</option>
                <option value="once">Once</option>
              </select>
            </label>
            {draft.repeat === 'weekly' && (
              <fieldset className="col-span-full min-w-0">
                <legend className="mb-1.5 text-[11px]">Start days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {weekdays.map((day) => (
                    <ButtonDay
                      key={day}
                      name={dayNames[day]}
                      selected={draft.days.includes(day)}
                      onClick={() =>
                        onChange({
                          days: weekdays.filter((value) =>
                            value === day
                              ? !draft.days.includes(value)
                              : draft.days.includes(value),
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </fieldset>
            )}
            <label className="workflow-field">
              {once ? 'Start date and time' : 'Start time'}
              <input
                type={once ? 'datetime-local' : 'time'}
                step="any"
                value={window.start}
                onChange={(event) => setBoundary('start', event.target.value)}
              />
            </label>
            <label className="workflow-field">
              {once ? 'Stop date and time' : 'Stop time'}
              <input
                type={once ? 'datetime-local' : 'time'}
                step="any"
                value={window.end}
                onChange={(event) => setBoundary('end', event.target.value)}
              />
            </label>
          </div>
          <label className="queue-setting">
            <span>
              <span className="font-medium">Catch up on startup</span>
              <small>Start if the daemon returns during an open window.</small>
            </span>
            <input
              type="checkbox"
              role="switch"
              aria-label="Catch up on startup"
              checked={draft.missed}
              onChange={(event) => onChange({ missed: event.target.checked })}
            />
          </label>
          <div className="queue-hint">
            <Clock3 aria-hidden="true" />
            <div>
              <p>
                {once
                  ? 'Enter one-time dates in your browser’s local timezone.'
                  : daemonTimezone
                    ? `Recurring times follow the daemon timezone (${daemonTimezone}).`
                    : 'Recurring times follow the daemon computer’s timezone.'}
              </p>
              {overnight && <p>The queue stops the following day.</p>}
            </div>
          </div>
        </>
      )}
      {scheduledStop && (
        <p className="text-[11px] text-muted-foreground">
          Current run stops{' '}
          <time dateTime={scheduledStop}>
            {new Date(scheduledStop).toLocaleString()}
          </time>{' '}
          (browser local time).
        </p>
      )}
    </div>
  );
}

function ButtonDay({
  name,
  selected,
  onClick,
}: {
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="queue-day"
      aria-label={name}
      aria-pressed={selected}
      onClick={onClick}
    >
      {name.slice(0, 2)}
    </button>
  );
}
