import { expect, it } from 'vitest';
import {
  downloadLiveStatusSchema,
  queueSchema,
  recurrenceSchema,
} from '@/shared/types/daemon';

const date = '2026-09-26T00:00:00Z';

it('decodes externally tagged live download errors and nullable progress fields', () => {
  const live = {
    download: {
      id: 1,
      aria2_gid: null,
      url: 'https://example.test/archive.zip',
      filename: null,
      destination_path: '/tmp/downloads',
      source_type: 'Http',
      category: 'Archive',
      status: { Error: 'Connection timed out' },
      paused_by_scheduler: false,
      manually_started: true,
      size: null,
      queue_id: 1,
      position_in_queue: 0,
      finetune: { max_retries: 0, stream_piece_selector: 'InOrder' },
      created_at: date,
      started_at: null,
      completed_at: null,
    },
    completed_length: 0,
    download_speed: 0,
    eta_seconds: null,
  };

  expect(downloadLiveStatusSchema.parse(live).download).toMatchObject({
    status: { Error: 'Connection timed out' },
    completed_length: null,
    finetune: {
      max_retries: 0,
      alloc_strategy: null,
      stream_piece_selector: 'InOrder',
    },
  });
  expect(
    downloadLiveStatusSchema.safeParse({
      ...live,
      download: { ...live.download, status: 'Error' },
    }).success,
  ).toBe(false);
});

it('decodes Rust schedule variants and defaults missing legacy queue fields', () => {
  const recurrence = {
    Weekly: {
      days: ['Mon', 'Sun'],
      start_time: '22:00:00',
      end_time: '06:00:00.500',
    },
  };
  const queue = queueSchema.parse({
    id: 1,
    name: 'Main',
    position: 0,
    settings: {
      max_concurrent_downloads: 1,
      max_retries: 3,
      default_finetune: {},
    },
    scheduler: { enabled: true, recurrence, run_missed_on_startup: false },
    created_at: date,
    status: 'Paused',
  });

  expect(queue).toMatchObject({
    scheduler: { recurrence },
    scheduled_stop_at: null,
    event_results: { on_success: null, on_stop: null },
    settings: {
      retry_wait_seconds: 5,
      on_success_command: null,
      on_stop_command: null,
    },
  });

  const oneTime = { Once: { start: date, end: '2026-09-26T01:00:00Z' } };
  expect(recurrenceSchema.parse(oneTime)).toEqual(oneTime);
});
