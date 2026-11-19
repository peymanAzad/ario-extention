import { browser } from 'wxt/browser';
import {
  downloadDraftSchema,
  type DownloadDraft,
} from '@/shared/types/download-workflows';

const key = 'downloadDraft';

export async function readDownloadDraft(origin: string) {
  const values = await browser.storage.local.get(key);
  const draft = downloadDraftSchema.safeParse(values[key]).data;
  return draft?.origin === origin ? draft : undefined;
}

let pending: Promise<void> = Promise.resolve();
export function writeDownloadDraft(draft: DownloadDraft): Promise<void> {
  pending = pending
    .catch(() => {})
    .then(() => browser.storage.local.set({ [key]: draft }));
  return pending;
}
