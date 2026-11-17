import { z } from 'zod';
import type { DaemonHealth, DaemonSettings } from './daemon';
import type { ExtensionError } from './connection';
import { settingsPatchSchema, type ExtensionSettings } from './settings';

export const backgroundMessageSchema = z.discriminatedUnion('operation', [
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
  'daemon.cancel': null;
  'settings.update': ExtensionSettings;
};

export type BackgroundReply<T> =
  { ok: true; data: T } | { ok: false; error: ExtensionError };
