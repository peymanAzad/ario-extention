import { z } from 'zod';
import type { BrowserCapabilities } from './browser-capabilities';
import { dashboardFiltersSchema, type DashboardFilters } from './dashboard';
import { fineTuneSchema } from './daemon';
import type {
  DaemonHealth,
  DaemonSettings,
  DownloadLiveStatus,
  Queue,
} from './daemon';
import {
  downloadDraftSchema,
  downloadIdSchema,
  downloadStatusKeySchema,
  downloadUrlSchema,
  importOptionsSchema,
  torrentUploadSchema,
  type DeleteFilesResult,
} from './download-workflows';
import type { ExtensionError } from './connection';
import { settingsPatchSchema, type ExtensionSettings } from './settings';
import {
  queueIdSchema,
  queueOrderSchema,
  queueSettingsInputSchema,
  queueSettingsSnapshotSchema,
  queueStatusSchema,
  type QueueUpdateResult,
} from './queue-workflows';

const daemonRequest = {
  requestId: z.uuid(),
  origin: z.string(),
};
const downloadRequest = { ...daemonRequest, id: downloadIdSchema };

export const backgroundMessageSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('dashboard.update'),
    filters: dashboardFiltersSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.health'),
    requestId: z.uuid(),
    origin: z.string(),
  }),
  z.strictObject({
    operation: z.literal('daemon.settings'),
    requestId: z.uuid(),
    origin: z.string(),
  }),
  z.strictObject({
    operation: z.literal('daemon.browserCapabilities'),
    ...daemonRequest,
  }),
  z.strictObject({
    operation: z.literal('daemon.downloads'),
    requestId: z.uuid(),
    origin: z.string(),
  }),
  z.strictObject({
    operation: z.literal('daemon.queues'),
    requestId: z.uuid(),
    origin: z.string(),
  }),
  z.strictObject({
    operation: z.literal('daemon.queue'),
    ...daemonRequest,
    id: queueIdSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.queue.create'),
    ...daemonRequest,
    settings: queueSettingsInputSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.queue.update'),
    ...daemonRequest,
    id: queueIdSchema,
    settings: queueSettingsInputSchema,
    expected: queueSettingsSnapshotSchema,
    order: queueOrderSchema.optional(),
  }),
  z.strictObject({
    operation: z.literal('daemon.queue.action'),
    ...daemonRequest,
    id: queueIdSchema,
    status: queueStatusSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.queue.delete'),
    ...daemonRequest,
    id: queueIdSchema,
    confirmed: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal('downloadDraft.update'),
    draft: downloadDraftSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download'),
    ...downloadRequest,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.add'),
    ...daemonRequest,
    url: downloadUrlSchema,
    options: importOptionsSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.torrent'),
    ...daemonRequest,
    file: torrentUploadSchema,
    options: importOptionsSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.action'),
    ...downloadRequest,
    expectedStatus: downloadStatusKeySchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.move'),
    ...downloadRequest,
    queueId: downloadIdSchema,
    expectedQueueId: downloadIdSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.finetune'),
    ...downloadRequest,
    fineTune: fineTuneSchema,
    expectedFineTune: fineTuneSchema,
    expectedQueueId: downloadIdSchema,
  }),
  z.strictObject({
    operation: z.literal('daemon.download.remove'),
    ...downloadRequest,
    deleteFiles: z.boolean(),
  }),
  z.strictObject({
    operation: z.literal('daemon.download.clearCompleted'),
    ...daemonRequest,
    queueId: downloadIdSchema.nullable(),
  }),
  z.strictObject({
    operation: z.literal('daemon.cancel'),
    requestId: z.uuid(),
  }),
  z.strictObject({
    operation: z.literal('settings.update'),
    patch: settingsPatchSchema,
  }),
]);

export type BackgroundMessage = z.input<typeof backgroundMessageSchema>;
export type BackgroundResults = {
  'daemon.health': DaemonHealth;
  'daemon.settings': DaemonSettings;
  'daemon.browserCapabilities': BrowserCapabilities | null;
  'daemon.downloads': DownloadLiveStatus[];
  'daemon.queues': Queue[];
  'daemon.queue': Queue;
  'daemon.queue.create': Queue;
  'daemon.queue.update': QueueUpdateResult;
  'daemon.queue.action': 'applied' | 'nothing-to-start';
  'daemon.queue.delete': 'deleted' | 'needs-confirmation';
  'daemon.download': DownloadLiveStatus;
  'daemon.download.add': DownloadLiveStatus;
  'daemon.download.torrent': DownloadLiveStatus;
  'daemon.download.action': DownloadLiveStatus;
  'daemon.download.move': DownloadLiveStatus;
  'daemon.download.finetune': DownloadLiveStatus;
  'daemon.download.remove': DeleteFilesResult | null;
  'daemon.download.clearCompleted': null;
  'downloadDraft.update': null;
  'dashboard.update': DashboardFilters;
  'daemon.cancel': null;
  'settings.update': ExtensionSettings;
};

export type BackgroundReply<T> =
  { ok: true; data: T } | { ok: false; error: ExtensionError };
