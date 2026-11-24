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

const captureFields = {
  askBeforeDownloading: z.boolean(),
  defaultQueueId: z.int().positive(),
  fineTuneOverride: fineTuneSchema.nullable(),
  startImmediately: z.boolean(),
  useBrowserSession: z.boolean(),
};
export const capturePreferencesSchema = z.object({
  enabled: z.boolean().default(true),
  askBeforeDownloading: captureFields.askBeforeDownloading.default(true),
  defaultQueueId: captureFields.defaultQueueId.default(1),
  fineTuneOverride: captureFields.fineTuneOverride.default(null),
  startImmediately: captureFields.startImmediately.default(true),
  useBrowserSession: captureFields.useBrowserSession.default(false),
});
export type CapturePreferences = z.infer<typeof capturePreferencesSchema>;

export const captureSettingsPatchSchema = z
  .strictObject(captureFields)
  .partial();
export type CaptureSettingsPatch = z.infer<typeof captureSettingsPatchSchema>;

export const extensionSettingsSchema = z.object({
  version: z.literal(1),
  connection: connectionSettingsSchema,
  appearance: appearanceSchema,
  detectMedia: z.boolean().default(true),
  capture: capturePreferencesSchema.default(() =>
    capturePreferencesSchema.parse({}),
  ),
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
    detectMedia: z.boolean(),
  })
  .partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
