import { z } from 'zod';
import {
  daemonAddressHint,
  defaultDaemonOrigin,
  parseDaemonOrigin,
} from '@/shared/api/endpoint';
import { appearanceSchema } from './appearance';
import { fineTuneSchema } from './daemon';

export const daemonOriginSchema = z.string().transform((address, context) => {
  const origin = parseDaemonOrigin(address);
  if (origin) return origin;
  context.addIssue({ code: 'custom', message: daemonAddressHint });
  return z.NEVER;
});
export const connectionSettingsSchema = z.strictObject({
  origin: daemonOriginSchema,
});

const capturePreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  askBeforeDownloading: z.boolean().default(true),
  defaultQueueId: z.int().positive().default(1),
  fineTuneOverride: fineTuneSchema.nullable().default(null),
  startImmediately: z.boolean().default(true),
  useBrowserSession: z.boolean().default(false),
});

export const extensionSettingsSchema = z.object({
  version: z.literal(1),
  connection: connectionSettingsSchema,
  appearance: appearanceSchema,
  capture: capturePreferencesSchema,
});
export type ExtensionSettings = z.infer<typeof extensionSettingsSchema>;

export const defaultExtensionSettings: ExtensionSettings =
  extensionSettingsSchema.parse({
    version: 1,
    connection: { origin: defaultDaemonOrigin },
    appearance: 'system',
    capture: {},
  });

export const settingsPatchSchema = z
  .strictObject({
    appearance: appearanceSchema,
    connection: connectionSettingsSchema,
  })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
