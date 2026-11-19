import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissCapture,
  getCaptureNotices,
  keepCapture,
  openCapture,
  retryCapture,
} from '@/shared/browser/messages';
import { browserRecoveryMessage } from '@/shared/types/capture';
import { Button } from '@/shared/ui/button';

const captureKey = ['capture-notices'];

export function CaptureNotices({ enabled }: { enabled: boolean }) {
  const client = useQueryClient();
  const notices = useQuery({
    queryKey: captureKey,
    queryFn: getCaptureNotices,
    enabled,
    retry: false,
    refetchInterval: 1500,
  });
  const action = useMutation({
    mutationFn: async ({
      id,
      operation,
    }: {
      id: string;
      operation: 'open' | 'keep' | 'retry' | 'dismiss';
    }) => {
      switch (operation) {
        case 'open':
          await openCapture(id);
          break;
        case 'keep':
          await keepCapture(id);
          break;
        case 'retry':
          await retryCapture(id);
          break;
        case 'dismiss':
          await dismissCapture(id);
          break;
      }
    },
    onSettled: () => void client.invalidateQueries({ queryKey: captureKey }),
  });
  if (!notices.data?.length && !action.error) return null;

  return (
    <section
      aria-label="Browser downloads"
      className="max-h-36 shrink-0 overflow-auto border-b border-border text-xs"
    >
      {notices.data?.map(({ id, state, fileName, canDismiss }) => (
        <div
          key={id}
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate font-medium">
              {fileName ?? 'Browser download'}
            </p>
            <p className="text-muted-foreground">
              {state === 'confirmation'
                ? 'Waiting for confirmation.'
                : state === 'pending'
                  ? 'Ario is checking the handoff.'
                  : browserRecoveryMessage}
            </p>
          </div>
          {state !== 'pending' && (
            <div className="flex flex-wrap gap-1">
              {(state === 'confirmation' || canDismiss) && (
                <Button
                  type="button"
                  className="h-7 px-2"
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() =>
                    action.mutate({
                      id,
                      operation: state === 'confirmation' ? 'keep' : 'dismiss',
                    })
                  }
                >
                  {state === 'confirmation' ? 'Keep in browser' : 'Dismiss'}
                </Button>
              )}
              <Button
                type="button"
                className="h-7 px-2"
                variant="outline"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({
                    id,
                    operation: state === 'confirmation' ? 'open' : 'retry',
                  })
                }
              >
                {state === 'confirmation'
                  ? 'Open confirmation'
                  : 'Retry resume'}
              </Button>
            </div>
          )}
        </div>
      ))}
      {action.error && (
        <p role="alert" className="px-3 py-2 text-destructive">
          {action.error.message}
        </p>
      )}
    </section>
  );
}
