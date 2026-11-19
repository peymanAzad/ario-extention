import { z } from 'zod';
import {
  fineTuneInput,
  parseFineTune,
} from '@/features/downloads/fine-tune-fields';
import {
  fineTuneSchema,
  type Queue,
  type Recurrence,
} from '@/shared/types/daemon';
import {
  queueNumberSchema,
  stopFollowsStart,
  weekdays,
  weeklyTimeKey,
  type QueueSettingsInput,
} from '@/shared/types/queue-workflows';

export type QueueTab = 'general' | 'schedule' | 'events' | 'downloads';
export type Repeat = 'once' | 'daily' | 'weekly';
type Weekday = (typeof weekdays)[number];

type TimeWindow = { start: string; end: string };
const defaultWeekly = {
  days: [],
  start_time: '02:00:00',
  end_time: '06:00:00',
};

export type ScheduleDraft = {
  enabled: boolean;
  missed: boolean;
  repeat: Repeat;
  days: Weekday[];
  weekly: TimeWindow;
  once: TimeWindow;
};

// Use native local field values, including seconds and milliseconds when present.
function localFieldValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local
    .toISOString()
    .slice(0, -1)
    .replace(/:00\.000$|\.000$/, '');
}

function localInstant(value: string) {
  const wallTime = Date.parse(`${value}Z`);
  if (
    !z.iso.datetime({ local: true }).safeParse(value).success ||
    !Number.isFinite(wallTime)
  )
    return null;

  // The offsets on each side of a clock change expose both possible instants
  // during a repeated hour and neither during a skipped hour.
  const day = 86_400_000;
  const offsets = new Set(
    [-day, 0, day].map((delta) =>
      new Date(wallTime + delta).getTimezoneOffset(),
    ),
  );
  const candidates = [...offsets]
    .map((offset) => new Date(wallTime + offset * 60_000))
    .filter((date) => Date.parse(`${localFieldValue(date)}Z`) === wallTime);
  return candidates.length === 1
    ? (candidates[0]?.toISOString() ?? null)
    : null;
}

function onceFields(
  recurrence: Extract<Recurrence, { Once: unknown }>['Once'],
) {
  return {
    start: localFieldValue(new Date(recurrence.start)),
    end: localFieldValue(new Date(recurrence.end)),
  };
}

function timeFieldValue(value: string) {
  return value.replace(/(\.\d{3})\d+$/, '$1');
}

export function queueDraft(queue?: Queue) {
  const recurrence = queue?.scheduler.recurrence;
  const weekly =
    recurrence && 'Weekly' in recurrence ? recurrence.Weekly : undefined;
  const once = recurrence && 'Once' in recurrence ? recurrence.Once : undefined;
  const days = weekdays.filter((day) => weekly?.days.includes(day));
  const now = Date.now();
  return {
    name: queue?.name ?? '',
    concurrency: String(queue?.settings.max_concurrent_downloads ?? 1),
    retries: String(queue?.settings.max_retries ?? 3),
    delay: String(queue?.settings.retry_wait_seconds ?? 5),
    fineTune: fineTuneInput(
      queue?.settings.default_finetune ?? fineTuneSchema.parse({}),
    ),
    successCommand: queue?.settings.on_success_command ?? '',
    stopCommand: queue?.settings.on_stop_command ?? '',
    schedule: {
      enabled: queue?.scheduler.enabled ?? false,
      missed: queue?.scheduler.run_missed_on_startup ?? false,
      repeat: once
        ? 'once'
        : days.length === weekdays.length
          ? 'daily'
          : 'weekly',
      days,
      weekly: {
        start: timeFieldValue(weekly?.start_time ?? defaultWeekly.start_time),
        end: timeFieldValue(weekly?.end_time ?? defaultWeekly.end_time),
      },
      once: onceFields(
        once ?? {
          start: new Date(Math.ceil(now / 60_000) * 60_000).toISOString(),
          end: new Date(
            Math.ceil(now / 60_000) * 60_000 + 4 * 3_600_000,
          ).toISOString(),
        },
      ),
    } satisfies ScheduleDraft,
  };
}

function buildRecurrence(
  schedule: ScheduleDraft,
  original?: Recurrence,
): Recurrence | string {
  const disabledFallback = original ?? { Weekly: defaultWeekly };
  if (schedule.repeat === 'once') {
    const stored = original && 'Once' in original ? original.Once : undefined;
    const fields = stored ? onceFields(stored) : undefined;
    const start =
      stored && fields?.start === schedule.once.start
        ? stored.start
        : localInstant(schedule.once.start);
    const end =
      stored && fields?.end === schedule.once.end
        ? stored.end
        : localInstant(schedule.once.end);
    if (!start || !end) {
      if (!schedule.enabled) return disabledFallback;
      return 'Enter valid local start and stop dates and times. Choose another time if the clock skips or repeats this time.';
    }
    if (schedule.enabled && !stopFollowsStart(start, end))
      return 'The stop date and time must be after the start.';
    return { Once: { start, end } };
  }

  const days = schedule.repeat === 'daily' ? [...weekdays] : schedule.days;
  const stored = original && 'Weekly' in original ? original.Weekly : undefined;
  const wireTime = (input: string, previous?: string) =>
    previous && input === timeFieldValue(previous)
      ? previous
      : input.length === 5
        ? `${input}:00`
        : input;
  const start = wireTime(schedule.weekly.start, stored?.start_time);
  const end = wireTime(schedule.weekly.end, stored?.end_time);
  if (
    !z.iso.time().safeParse(start).success ||
    !z.iso.time().safeParse(end).success
  ) {
    if (!schedule.enabled) return disabledFallback;
    return 'Enter a start and stop time.';
  }
  if (schedule.enabled && days.length === 0) return 'Select at least one day.';
  if (schedule.enabled && weeklyTimeKey(start) === weeklyTimeKey(end))
    return 'Choose different start and stop times.';
  const preserveDays =
    stored &&
    new Set(stored.days).size === days.length &&
    days.every((day) => stored.days.includes(day));
  return {
    Weekly: {
      days: preserveDays ? stored.days : days,
      start_time: start,
      end_time: end,
    },
  };
}

type QueueDraft = ReturnType<typeof queueDraft>;
type SettingsResult =
  { settings: QueueSettingsInput } | { tab: QueueTab; message: string };

export function buildQueueSettings(
  draft: QueueDraft,
  original?: Recurrence,
): SettingsResult {
  const invalid = (tab: QueueTab, message: string) => ({ tab, message });
  const unsigned = (value: string) =>
    /^\d+$/.test(value) && queueNumberSchema.safeParse(Number(value)).success;
  if (!draft.name.trim()) return invalid('general', 'Enter a queue name.');
  if (!unsigned(draft.concurrency) || Number(draft.concurrency) < 1)
    return invalid(
      'general',
      'Concurrent downloads must be a positive whole number up to 4294967295.',
    );
  if (!unsigned(draft.retries) || !unsigned(draft.delay))
    return invalid(
      'general',
      'Enter whole numbers from 0 to 4294967295 for retries and retry delay.',
    );
  const fineTune = parseFineTune(draft.fineTune);
  if (!fineTune.success)
    return invalid(
      'general',
      'Use whole numbers from 0 to 4294967295 for download defaults, or leave them blank to inherit.',
    );
  const recurrence = buildRecurrence(draft.schedule, original);
  if (typeof recurrence === 'string') return invalid('schedule', recurrence);

  return {
    settings: {
      name: draft.name,
      max_concurrent_downloads: Number(draft.concurrency),
      max_retries: Number(draft.retries),
      retry_wait_seconds: Number(draft.delay),
      default_finetune: fineTune.data,
      scheduler_enabled: draft.schedule.enabled,
      recurrence,
      run_missed_on_startup: draft.schedule.missed,
      on_success_command: draft.successCommand.trim()
        ? draft.successCommand
        : '',
      on_stop_command: draft.stopCommand.trim() ? draft.stopCommand : '',
    },
  };
}
