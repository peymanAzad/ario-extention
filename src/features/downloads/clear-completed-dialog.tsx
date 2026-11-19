import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { daemonKeys } from '@/shared/api/queries';
import { writeDownload } from '@/shared/browser/messages';
import { Button } from '@/shared/ui/button';
import { workflowError } from './workflow-model';
import { WorkflowDialog } from './workflow-dialog';

export function ClearCompletedDialog({
  origin,
  queueId,
  queueName,
  unavailable,
  onClose,
  onCleared,
}: {
  origin: string;
  queueId: number | null;
  queueName: string;
  unavailable: boolean;
  onClose: () => void;
  onCleared: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);

  async function clear() {
    if (submitting.current || unavailable) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await writeDownload('daemon.download.clearCompleted', {
        origin,
        queueId,
      });
      onCleared();
    } catch (error) {
      setError(workflowError(error));
    } finally {
      void queryClient.invalidateQueries({
        queryKey: daemonKeys.origin(origin),
      });
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <WorkflowDialog
      title="Clear completed downloads?"
      description={`Remove all completed records in ${queueName}. Downloaded files will be kept.`}
      onClose={onClose}
      busy={busy}
    >
      {error && (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="workflow-actions">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={busy || unavailable}
          onClick={() => void clear()}
        >
          {busy ? 'Clearing…' : 'Clear completed'}
        </Button>
      </div>
    </WorkflowDialog>
  );
}
