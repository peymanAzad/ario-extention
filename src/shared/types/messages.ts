import { z } from 'zod';
import { dashboardFiltersSchema, type DashboardFilters } from './dashboard';
import type {
  DaemonHealth,
  DaemonSettings,
  DownloadLiveStatus,
  Queue,
} from './daemon';
import type { ExtensionError } from './connection';
import { settingsPatchSchema, type ExtensionSettings } from './settings';

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
  'daemon.downloads': DownloadLiveStatus[];
  'daemon.queues': Queue[];
  'dashboard.update': DashboardFilters;
  'daemon.cancel': null;
  'settings.update': ExtensionSettings;
};

export type BackgroundReply<T> =
  { ok: true; data: T } | { ok: false; error: ExtensionError };
