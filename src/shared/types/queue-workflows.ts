import { z } from 'zod';
import {
  fineTuneSchema,
  recurrenceSchema,
  type DownloadLiveStatus,
  type Queue,
} from './daemon';

export const mainQueueId = 1;
export const queueIdSchema = z.int().positive();
export const queueStatusSchema = z.enum(['Active', 'Paused']);
export const weekdays = [
  'Mon',
  'Tue',
  'Wed',
  'Thu',
  'Fri',
  'Sat',
  'Sun',
] as const;
export const queueNumberSchema = z.int().min(0).max(0xffff_ffff);

export function weeklyTimeKey(value: string) {
  const [clock = '', fraction = ''] = value.split('.');
  return `${clock.length === 5 ? `${clock}:00` : clock}.${fraction.padEnd(9, '0')}`;
}

export function stopFollowsStart(start: string, stop: string) {
  const difference = Date.parse(stop) - Date.parse(start);
  if (difference !== 0) return difference > 0;
  const fraction = (value: string) =>
    (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0');
  return fraction(start) < fraction(stop);
}

export const queueSettingsSnapshotSchema = z.strictObject({
  name: z.string(),
  max_concurrent_downloads: queueNumberSchema,
  max_retries: queueNumberSchema,
  retry_wait_seconds: queueNumberSchema,
  default_finetune: fineTuneSchema,
  scheduler_enabled: z.boolean(),
  recurrence: recurrenceSchema,
  run_missed_on_startup: z.boolean(),
  on_success_command: z.string(),
  on_stop_command: z.string(),
});

export const queueSettingsInputSchema = queueSettingsSnapshotSchema
  .extend({
    name: z
      .string()
      .refine((name) => name.trim().length > 0, 'Enter a queue name.'),
    max_concurrent_downloads: queueNumberSchema.min(1),
  })
  .refine((settings) => {
    if (!settings.scheduler_enabled) return true;
    const { recurrence } = settings;
    if ('Once' in recurrence)
      return stopFollowsStart(recurrence.Once.start, recurrence.Once.end);
    const { days, start_time, end_time } = recurrence.Weekly;
    return (
      days.length > 0 && weeklyTimeKey(start_time) !== weeklyTimeKey(end_time)
    );
  }, 'Choose valid days and distinct start and stop times.');

export type QueueSettingsInput = z.output<typeof queueSettingsInputSchema>;

export function queueSettingsSnapshot(queue: Queue): QueueSettingsInput {
  return {
    name: queue.name,
    max_concurrent_downloads: queue.settings.max_concurrent_downloads,
    max_retries: queue.settings.max_retries,
    retry_wait_seconds: queue.settings.retry_wait_seconds,
    default_finetune: queue.settings.default_finetune,
    scheduler_enabled: queue.scheduler.enabled,
    recurrence: queue.scheduler.recurrence,
    run_missed_on_startup: queue.scheduler.run_missed_on_startup,
    on_success_command: queue.settings.on_success_command ?? '',
    on_stop_command: queue.settings.on_stop_command ?? '',
  };
}

export const queueOrderSchema = z
  .strictObject({
    previous: z.array(queueIdSchema).min(2),
    ordered: z.array(queueIdSchema).min(2),
  })
  .refine(({ previous, ordered }) => {
    const ids = new Set(previous);
    return (
      ids.size === previous.length &&
      ids.size === ordered.length &&
      new Set(ordered).size === ids.size &&
      ordered.every((id) => ids.has(id))
    );
  });

export function sameOrder(a: number[], b: number[]) {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function queueDownloads(
  downloads: DownloadLiveStatus[],
  queueId: number,
) {
  return downloads
    .filter(({ download }) => download.queue_id === queueId)
    .sort(
      (a, b) =>
        a.download.position_in_queue - b.download.position_in_queue ||
        a.download.id - b.download.id,
    );
}

export type QueueUpdateResult = { queue: Queue; orderError: string | null };
