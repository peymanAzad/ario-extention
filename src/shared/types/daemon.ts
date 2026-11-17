import { z } from 'zod';

const uint = z.int().nonnegative();
const uint32 = uint.max(0xffff_ffff);
const int32 = z.int().min(-0x8000_0000).max(0x7fff_ffff);
const dateTime = z.iso.datetime({ offset: true });
const optionalString = z.string().nullable().default(null);
const optionalDateTime = dateTime.nullable().default(null);
const fileCategory = z.enum([
  'Video',
  'Music',
  'Document',
  'Archive',
  'Program',
  'Other',
]);
const downloadStatus = z.union([
  z.enum(['Pending', 'Active', 'Paused', 'Completed', 'Removed']),
  z.strictObject({ Error: z.string() }),
]);

const aria2GlobalOptions = z.object({
  connections_per_download: uint32.nullable().default(null),
  max_connections_per_server: uint32.nullable().default(null),
  alloc_strategy: z
    .enum(['None', 'Prealloc', 'Falloc', 'Trunc'])
    .nullable()
    .default(null),
  stream_piece_selector: z
    .enum(['Default', 'InOrder', 'Random', 'Geom'])
    .nullable()
    .default(null),
});

export const fineTuneSchema = aria2GlobalOptions.extend({
  max_retries: uint32.nullable().default(null),
  retry_wait_seconds: uint32.nullable().default(null),
});
export type FineTune = z.infer<typeof fineTuneSchema>;

export const healthSchema = z.object({
  server: z.literal('ok'),
  aria2_reachable: z.boolean(),
  proxy_reachable: z.boolean().optional(),
  proxy_data: z.boolean().optional(),
  tui_managed: z.boolean(),
  download_speed: uint,
  active_downloads: uint,
  aria2_global_options: aria2GlobalOptions.optional(),
});
export type DaemonHealth = z.infer<typeof healthSchema>;

export const daemonSettingsSchema = z.object({
  default_download_location: z.string(),
  category_locations: z.partialRecord(fileCategory, z.string()),
  category_extensions: z.partialRecord(fileCategory, z.array(z.string())),
  // The extension only needs the proxy endpoint. Discard credentials at the boundary.
  proxy: z
    .object({
      enabled: z.boolean().default(false),
      host: optionalString,
      port: uint.max(65535).nullable().default(null),
    })
    .prefault({}),
  start_daemon_on_login: z.boolean(),
  stop_daemon_on_close: z.boolean(),
});
export type DaemonSettings = z.infer<typeof daemonSettingsSchema>;

const downloadSchema = z.object({
  id: z.int(),
  aria2_gid: optionalString,
  url: z.string(),
  filename: optionalString,
  destination_path: z.string(),
  source_type: z.enum(['Http', 'Torrent', 'Magnet']),
  category: fileCategory,
  status: downloadStatus,
  paused_by_scheduler: z.boolean(),
  manually_started: z.boolean(),
  size: uint.nullable().default(null),
  completed_length: uint.nullable().default(null),
  queue_id: z.int(),
  position_in_queue: int32,
  finetune: fineTuneSchema,
  created_at: dateTime,
  started_at: optionalDateTime,
  completed_at: optionalDateTime,
});

export const downloadLiveStatusSchema = z.object({
  download: downloadSchema,
  completed_length: uint,
  download_speed: uint,
  eta_seconds: uint.nullable().default(null),
});
export type DownloadLiveStatus = z.infer<typeof downloadLiveStatusSchema>;

export const recurrenceSchema = z.union([
  z.strictObject({ Once: z.object({ start: dateTime, end: dateTime }) }),
  z.strictObject({
    Weekly: z.object({
      days: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])),
      start_time: z.iso.time(),
      end_time: z.iso.time(),
    }),
  }),
]);
export type Recurrence = z.infer<typeof recurrenceSchema>;

const queueEventResult = z.object({
  id: z.int(),
  run_id: z.int(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'interrupted']),
  queued_at: dateTime,
  started_at: optionalDateTime,
  finished_at: optionalDateTime,
  exit_code: int32.nullable().default(null),
  message: optionalString,
});

export const queueSchema = z.object({
  id: z.int(),
  name: z.string(),
  position: int32,
  settings: z.object({
    on_success_command: optionalString,
    on_stop_command: optionalString,
    max_concurrent_downloads: uint32,
    max_retries: uint32,
    retry_wait_seconds: uint32.default(5),
    default_finetune: fineTuneSchema,
  }),
  scheduler: z.object({
    enabled: z.boolean(),
    recurrence: recurrenceSchema,
    run_missed_on_startup: z.boolean(),
  }),
  created_at: dateTime,
  status: z.enum(['Active', 'Paused']),
  scheduled_stop_at: optionalDateTime,
  event_results: z
    .object({
      on_success: queueEventResult.nullable().default(null),
      on_stop: queueEventResult.nullable().default(null),
    })
    .prefault({}),
});
export type Queue = z.infer<typeof queueSchema>;
