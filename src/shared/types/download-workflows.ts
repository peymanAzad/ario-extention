import { z } from 'zod';
import { fineTuneSchema } from './daemon';
import { statuses } from './dashboard';

export const torrentLimit = 16 * 1024 * 1024;

export const downloadIdSchema = z.int().positive();
export const downloadStatusKeySchema = z.enum(statuses);
export const importOptionsSchema = z.strictObject({
  queue_id: downloadIdSchema,
  finetune_override: fineTuneSchema.nullable(),
  start_immediately: z.boolean(),
});
export type ImportOptions = z.output<typeof importOptionsSchema>;

export const downloadUrlSchema = z.string().refine((value) => {
  if (/\s/.test(value)) return false;
  try {
    const url = new URL(value);
    if (/^https?:\/\//i.test(value)) return Boolean(url.hostname);
    return (
      value.startsWith('magnet:?') &&
      url.searchParams.getAll('xt').some(Boolean)
    );
  } catch {
    return false;
  }
});

export const torrentUploadSchema = z.strictObject({
  name: z.string().regex(/^[^/\\]+\.torrent$/i),
  base64: z
    .base64()
    .min(4)
    .max(Math.ceil(torrentLimit / 3) * 4),
});

export const deleteFilesResultSchema = z.object({
  removed_payloads: z.int().nonnegative(),
  missing_payloads: z.int().nonnegative(),
  metadata_complete: z.boolean(),
});
export type DeleteFilesResult = z.infer<typeof deleteFilesResultSchema>;

export const downloadDraftSchema = z.strictObject({
  origin: z.string(),
  queueId: downloadIdSchema.nullable(),
  override: z.boolean(),
  fineTune: fineTuneSchema,
});
export type DownloadDraft = z.output<typeof downloadDraftSchema>;
