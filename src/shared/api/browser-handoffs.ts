import { z } from 'zod';
import { ArioError } from '@/shared/types/connection';
import { browserCapabilitiesSchema } from '@/shared/types/browser-capabilities';
import type { ImportOptions } from '@/shared/types/download-workflows';
import { downloadIdSchema } from '@/shared/types/download-workflows';
import { requestDaemon } from './transport';

export function hasHttpStatus(error: unknown, status: number): boolean {
  return error instanceof ArioError && error.detail.status === status;
}

export async function readBrowserCapabilities(
  origin: string,
  signal?: AbortSignal,
) {
  try {
    return await requestDaemon(
      origin,
      '/browser-capabilities',
      browserCapabilitiesSchema,
      { signal },
    );
  } catch (error) {
    if (hasHttpStatus(error, 404)) return null;
    throw error;
  }
}

const receiptFields = { id: z.uuid() };
const receiptSchema = z.discriminatedUnion('state', [
  z.object({
    ...receiptFields,
    state: z.literal('staged'),
    download_id: z.null(),
  }),
  z.object({
    ...receiptFields,
    state: z.literal('aborted'),
    download_id: z.null(),
  }),
  z.object({
    ...receiptFields,
    state: z.literal('committed'),
    download_id: downloadIdSchema,
  }),
]);

export type HandoffReceipt = z.infer<typeof receiptSchema>;

function receiptFor(id: string) {
  return receiptSchema.refine((receipt) => receipt.id === id);
}

export function stageBrowserHandoff(
  origin: string,
  id: string,
  url: string,
  options: ImportOptions,
  cookie: string | undefined,
) {
  return requestDaemon(origin, '/browser-handoffs', receiptFor(id), {
    method: 'POST',
    body: {
      json: {
        id,
        request: {
          ...options,
          url,
          method: url.startsWith('magnet:') ? undefined : 'GET',
          session: cookie === undefined ? undefined : { cookie },
        },
      },
    },
  });
}

export async function readBrowserHandoff(origin: string, id: string) {
  try {
    return await requestDaemon(
      origin,
      `/browser-handoffs/${id}`,
      receiptFor(id),
    );
  } catch (error) {
    if (hasHttpStatus(error, 404)) return null;
    throw error;
  }
}

export function resolveBrowserHandoff(
  origin: string,
  id: string,
  action: 'commit' | 'abort',
) {
  return requestDaemon(
    origin,
    `/browser-handoffs/${id}/${action}`,
    receiptFor(id),
    {
      method: 'POST',
      body: { json: {} },
    },
  );
}
