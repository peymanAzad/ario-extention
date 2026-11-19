import { browser } from 'wxt/browser';
import { z } from 'zod';
import { confirmationIdSchema } from '@/shared/types/confirmation';
import {
  downloadIdSchema,
  importOptionsSchema,
} from '@/shared/types/download-workflows';
import { daemonOriginSchema } from '@/shared/types/settings';

const prefix = 'arioCapture:';
export const captureKey = (id: string) => `${prefix}${id}`;

const identitySchema = z.object({
  browserId: z.int().nonnegative(),
  startedAt: z.iso.datetime(),
});
export type DownloadIdentity = z.infer<typeof identitySchema>;

const captureBase = identitySchema.extend({
  origin: daemonOriginSchema,
});
const withHandoff = captureBase.extend({
  handoffId: confirmationIdSchema,
  suppress: z.boolean(),
});
const recordSchema = z.discriminatedUnion('phase', [
  captureBase.extend({ phase: z.enum(['pausing', 'awaiting']) }),
  withHandoff.extend({ phase: z.enum(['staging', 'canceling', 'commit']) }),
  captureBase.extend({
    phase: z.literal('fallback'),
    handoffId: confirmationIdSchema.optional(),
    // An absent receipt shortly after a transport failure may race a stage.
    checkUntil: z.number().optional(),
    browser: z.enum(['restore', 'restored', 'recovery']),
  }),
  captureBase.extend({ phase: z.literal('recovery') }),
]);
export type CaptureRecord = z.infer<typeof recordSchema>;

const draftSchema = z.object({
  url: z.string(),
  fileName: z.string().optional(),
  totalBytes: z.number().positive().optional(),
  options: importOptionsSchema,
  session: z.boolean(),
  automatic: z.boolean(),
  windowId: z.int().nonnegative().optional(),
  outcome: z.discriminatedUnion('state', [
    z.object({ state: z.enum(['draft', 'pending', 'browser', 'recovery']) }),
    z.object({ state: z.literal('committed'), downloadId: downloadIdSchema }),
  ]),
  origin: daemonOriginSchema,
});
export type CaptureDraft = z.infer<typeof draftSchema>;

export async function readCapture(id: string) {
  const key = captureKey(id);
  return recordSchema.safeParse((await browser.storage.local.get(key))[key])
    .data;
}

export async function listCaptures() {
  const values = await browser.storage.local.get(null);
  return Object.entries(values).flatMap(([key, value]) => {
    if (!key.startsWith(prefix)) return [];
    const id = confirmationIdSchema.safeParse(key.slice(prefix.length)).data;
    const record = recordSchema.safeParse(value).data;
    return id && record ? [{ id, record }] : [];
  });
}

export function saveCapture(id: string, record: CaptureRecord) {
  return browser.storage.local.set({ [captureKey(id)]: record });
}

export function removeCapture(id: string) {
  return browser.storage.local.remove(captureKey(id));
}

export async function readCaptureDraft(id: string) {
  const key = captureKey(id);
  return draftSchema.safeParse((await browser.storage.session.get(key))[key])
    .data;
}

export async function listCaptureDrafts() {
  const values = await browser.storage.session.get(null);
  return Object.entries(values).flatMap(([key, value]) => {
    if (!key.startsWith(prefix)) return [];
    const draft = draftSchema.safeParse(value).data;
    return draft ? [{ id: key.slice(prefix.length), draft }] : [];
  });
}

export function saveCaptureDraft(id: string, draft: CaptureDraft) {
  return browser.storage.session.set({ [captureKey(id)]: draft });
}

export function removeCaptureDraft(id: string) {
  return browser.storage.session.remove(captureKey(id));
}
