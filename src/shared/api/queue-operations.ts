import { requestDaemon } from './transport';
import { ArioError } from '@/shared/types/connection';
import { downloadLiveStatusSchema, queueSchema } from '@/shared/types/daemon';
import type { backgroundMessageSchema } from '@/shared/types/messages';
import type { output } from 'zod';
import {
  mainQueueId,
  queueDownloads,
  queueSettingsSnapshot,
  sameOrder,
} from '@/shared/types/queue-workflows';

type QueueOperation = Extract<
  output<typeof backgroundMessageSchema>,
  { operation: `daemon.queue.${string}` }
>;

function isConflict(error: unknown, message: string) {
  return (
    error instanceof ArioError &&
    error.detail.status === 409 &&
    error.message === message
  );
}

export async function runQueueOperation(
  message: QueueOperation,
  signal: AbortSignal,
) {
  const { origin } = message;
  if (message.operation === 'daemon.queue.create') {
    return requestDaemon(origin, '/queues', queueSchema, {
      method: 'POST',
      body: { json: { ...message.settings, position: 0 } },
      signal,
    });
  }

  const path = `/queues/${message.id}` as const;
  switch (message.operation) {
    case 'daemon.queue.update': {
      const current = await requestDaemon(origin, path, queueSchema, {
        signal,
      });
      const currentSettings = queueSettingsSnapshot(current);
      const { expected, settings, order } = message;
      // Compare only editable settings. Live status and event results may change during editing.
      const matches = (value: typeof currentSettings) =>
        JSON.stringify(currentSettings) === JSON.stringify(value);
      let queue = current;
      if (!matches(settings)) {
        if (!matches(expected)) {
          throw new ArioError({
            kind: 'extension',
            message:
              'Queue settings changed. Reopen the editor to load the latest settings.',
          });
        }
        queue = await requestDaemon(origin, path, queueSchema, {
          method: 'PUT',
          body: { json: { ...settings, position: current.position } },
          signal,
        });
      }
      let orderError: string | null = null;
      if (order) {
        try {
          const downloads = await requestDaemon(
            origin,
            `/downloads?queue_id=${message.id}`,
            downloadLiveStatusSchema.array(),
            { signal },
          );
          const currentOrder = queueDownloads(downloads, message.id).map(
            ({ download }) => download.id,
          );
          if (!sameOrder(currentOrder, order.ordered)) {
            if (!sameOrder(currentOrder, order.previous)) {
              throw new Error(
                'Queue items or their order changed. Reset the staged order before trying again.',
              );
            }
            await requestDaemon(origin, `${path}/reorder`, 'empty', {
              method: 'PUT',
              body: { json: { ordered_ids: order.ordered } },
              signal,
            });
          }
        } catch (error) {
          orderError =
            error instanceof Error ? error.message : 'Reordering failed.';
        }
      }
      return { queue, orderError };
    }
    case 'daemon.queue.action': {
      const action = message.status === 'Active' ? 'pause' : 'resume';
      try {
        await requestDaemon(origin, `${path}/${action}`, 'empty', {
          method: 'POST',
          signal,
        });
        return 'applied' as const;
      } catch (error) {
        if (
          action === 'resume' &&
          isConflict(error, 'Queue has no pending or paused downloads')
        )
          return 'nothing-to-start' as const;
        throw error;
      }
    }
    case 'daemon.queue.delete': {
      if (message.id === mainQueueId) {
        throw new ArioError({
          kind: 'extension',
          message: 'Main Queue cannot be deleted.',
        });
      }
      try {
        await requestDaemon(
          origin,
          message.confirmed ? `${path}?delete_downloads=true` : path,
          'empty',
          { method: 'DELETE', signal },
        );
        return 'deleted' as const;
      } catch (error) {
        if (
          !message.confirmed &&
          isConflict(
            error,
            'queue contains download items; confirmation is required',
          )
        )
          return 'needs-confirmation' as const;
        throw error;
      }
    }
  }
}
