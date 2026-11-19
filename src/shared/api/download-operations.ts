import { z } from 'zod';
import { requestDaemon } from './transport';
import { ArioError } from '@/shared/types/connection';
import { downloadLiveStatusSchema } from '@/shared/types/daemon';
import {
  deleteFilesResultSchema,
  torrentLimit,
} from '@/shared/types/download-workflows';
import type {
  backgroundMessageSchema,
  BackgroundResults,
} from '@/shared/types/messages';

type DownloadOperation = Extract<
  z.output<typeof backgroundMessageSchema>,
  { operation: 'daemon.download' | `daemon.download.${string}` }
>;
type DownloadResult = BackgroundResults[DownloadOperation['operation']];

const singleDownload = z.tuple([downloadLiveStatusSchema]);

function changed(message: string): never {
  throw new ArioError({ kind: 'http', status: 409, message });
}

export async function runDownloadOperation(
  message: DownloadOperation,
  signal: AbortSignal,
): Promise<DownloadResult> {
  const { origin } = message;
  const options = { signal };
  if (message.operation === 'daemon.download.add') {
    const [created] = await requestDaemon(
      origin,
      '/downloads',
      singleDownload,
      {
        ...options,
        method: 'POST',
        body: { json: { ...message.options, inputs: [{ Url: message.url }] } },
      },
    );
    return created;
  }
  if (message.operation === 'daemon.download.torrent') {
    const decoded = atob(message.file.base64);
    if (decoded.length > torrentLimit) {
      throw new ArioError({
        kind: 'http',
        status: 413,
        message: 'Torrent files must be 16 MiB or smaller.',
      });
    }
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    const body = new FormData();
    body.set('metadata', JSON.stringify(message.options));
    body.set(
      'file',
      new Blob([bytes], { type: 'application/x-bittorrent' }),
      message.file.name,
    );
    return requestDaemon(
      origin,
      '/downloads/torrent',
      downloadLiveStatusSchema,
      {
        ...options,
        method: 'POST',
        body,
      },
    );
  }
  if (message.operation === 'daemon.download.clearCompleted') {
    const query =
      message.queueId === null ? '' : `?queue_id=${message.queueId}`;
    await requestDaemon(origin, `/downloads/completed${query}`, 'empty', {
      ...options,
      method: 'DELETE',
    });
    return null;
  }

  const path = `/downloads/${message.id}` as const;
  if (message.operation === 'daemon.download.remove') {
    if (message.deleteFiles) {
      return requestDaemon(
        origin,
        `${path}?delete_files=true`,
        deleteFilesResultSchema,
        {
          ...options,
          method: 'DELETE',
        },
      );
    }
    await requestDaemon(origin, path, 'empty', {
      ...options,
      method: 'DELETE',
    });
    return null;
  }

  const current = await requestDaemon(
    origin,
    path,
    downloadLiveStatusSchema,
    options,
  );
  if (message.operation === 'daemon.download') return current;

  // The daemon can change between dashboard polls. Check before invoking the
  // status-dependent resume route or overwriting settings from an older view.
  const download = current.download;
  if (message.operation === 'daemon.download.action') {
    const status =
      typeof download.status === 'object' ? 'Error' : download.status;
    if (status !== message.expectedStatus) {
      changed(
        'The download status changed. Review its current action and try again.',
      );
    }
    const action = status === 'Active' ? 'pause' : 'resume';
    return requestDaemon(
      origin,
      `${path}/${action}`,
      downloadLiveStatusSchema,
      {
        ...options,
        method: 'POST',
      },
    );
  }

  if (download.queue_id !== message.expectedQueueId) {
    changed(
      'The download moved to another queue. Review the current queue and try again.',
    );
  }
  if (message.operation === 'daemon.download.move') {
    return requestDaemon(origin, `${path}/queue`, downloadLiveStatusSchema, {
      ...options,
      method: 'PUT',
      body: { json: { queue_id: message.queueId } },
    });
  }

  if (
    JSON.stringify(download.finetune) !==
    JSON.stringify(message.expectedFineTune)
  ) {
    changed(
      'Download settings changed. Reopen the editor to use the latest values.',
    );
  }
  return requestDaemon(origin, `${path}/finetune`, downloadLiveStatusSchema, {
    ...options,
    method: 'PUT',
    body: { json: message.fineTune },
  });
}
