import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  buildQueueSettings,
  queueDraft,
} from '@/features/queues/queue-editor-model';
import { nightQueue } from './fixtures/dashboard';

const timezone = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  if (timezone === undefined) delete process.env.TZ;
  else process.env.TZ = timezone;
});

it('rejects a skipped spring hour and converts an overnight one-time window across the DST change', () => {
  const draft = queueDraft();
  draft.name = 'Spring';
  draft.schedule.enabled = true;
  draft.schedule.repeat = 'once';
  draft.schedule.once = { start: '2030-03-09T23:30', end: '2030-03-10T02:30' };
  expect(buildQueueSettings(draft)).toMatchObject({
    tab: 'schedule',
    message: expect.stringContaining('skips or repeats'),
  });
  draft.schedule.once.end = '2030-03-10T03:30';
  expect(buildQueueSettings(draft)).toMatchObject({
    settings: {
      recurrence: {
        Once: {
          start: '2030-03-10T04:30:00.000Z',
          end: '2030-03-10T07:30:00.000Z',
        },
      },
    },
  });
});

it('rejects a newly entered repeated fall hour and preserves exact UTC instants from existing schedules', () => {
  const recurrence = {
    Once: { start: '2030-11-03T06:30:00.123456Z', end: '2030-11-03T07:30:00Z' },
  };
  const draft = queueDraft({
    ...nightQueue,
    scheduler: { enabled: true, recurrence, run_missed_on_startup: false },
  });
  expect(draft.schedule.once).toEqual({
    start: '2030-11-03T01:30:00.123',
    end: '2030-11-03T02:30',
  });
  expect(buildQueueSettings(draft, recurrence)).toMatchObject({
    settings: { recurrence },
  });
  draft.schedule.once.start = '2030-11-03T01:15';
  expect(buildQueueSettings(draft, recurrence)).toMatchObject({
    tab: 'schedule',
    message: expect.stringContaining('skips or repeats'),
  });
});
