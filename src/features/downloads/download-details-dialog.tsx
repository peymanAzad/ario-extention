import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { daemonKeys, useDownload } from '@/shared/api/queries';
import { writeDownload } from '@/shared/browser/messages';
import type { DeleteFilesResult } from '@/shared/types/download-workflows';
import type { DownloadLiveStatus, Queue } from '@/shared/types/daemon';
import { Button } from '@/shared/ui/button';
import {
  downloadName,
  formatBytes,
  statusKey,
  statusLabels,
} from './dashboard-model';
import {
  FineTuneFields,
  fineTuneInput,
  parseFineTune,
} from './fine-tune-fields';
import { downloadActions, workflowError } from './workflow-model';
import { WorkflowDialog } from './workflow-dialog';

type Panel = 'details' | 'move' | 'settings' | 'remove' | 'delete';
type Editor =
  | { panel: 'details' }
  | { panel: Exclude<Panel, 'details'>; base: DownloadLiveStatus['download'] };

export function DownloadDetailsDialog({
  origin,
  id,
  name,
  queues,
  visible,
  unavailable,
  isActionPending,
  action,
  actionError,
  onClose,
  onRemoved,
}: {
  origin: string;
  id: number;
  name: string;
  queues: Queue[];
  visible: boolean;
  unavailable: boolean;
  isActionPending: (item: DownloadLiveStatus) => boolean;
  action: (item: DownloadLiveStatus) => void;
  actionError?: string;
  onClose: () => void;
  onRemoved: (message: string) => void;
}) {
  const itemQuery = useDownload(origin, id, visible);
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<Editor>({ panel: 'details' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [queueId, setQueueId] = useState<number>();
  const [fineTune, setFineTune] = useState<ReturnType<typeof fineTuneInput>>();
  const submitting = useRef(false);

  const item = itemQuery.data;
  const download = item?.download;
  const title = {
    details: 'Download details',
    move: 'Move download',
    settings: 'Download settings',
    remove: 'Remove download?',
    delete: 'Delete download and files?',
  }[editor.panel];
  const pending = item ? isActionPending(item) : false;
  const blocked = busy || pending || unavailable || itemQuery.isError || !item;

  function open(panel: Panel) {
    setError('');
    setNotice('');
    if (panel === 'details') {
      setEditor({ panel });
    } else if (download) {
      setQueueId(download.queue_id);
      setFineTune(fineTuneInput(download.finetune));
      setEditor({ panel, base: download });
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
      setError('');
    } catch {
      setError(
        `Could not copy ${label.toLowerCase()}. You can select and copy it from the details.`,
      );
    }
  }

  async function save() {
    if (!canSave || submitting.current || editor.panel === 'details') return;
    const { base, panel } = editor;
    const payload = { origin, id };
    submitting.current = true;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      if (panel === 'move' && queueId !== undefined) {
        await writeDownload('daemon.download.move', {
          ...payload,
          queueId,
          expectedQueueId: base.queue_id,
        });
        open('details');
        setNotice('Download moved.');
      } else if (panel === 'settings' && fineTune) {
        const parsed = parseFineTune(fineTune);
        if (!parsed.success) return;
        await writeDownload('daemon.download.finetune', {
          ...payload,
          fineTune: parsed.data,
          expectedFineTune: base.finetune,
          expectedQueueId: base.queue_id,
        });
        open('details');
        setNotice('Download settings saved.');
      } else if (panel === 'remove' || panel === 'delete') {
        const result = await writeDownload('daemon.download.remove', {
          ...payload,
          deleteFiles: panel === 'delete',
        });
        onRemoved(
          result
            ? describeDeletion(result)
            : 'Download record removed. Files kept.',
        );
      }
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

  const changedQueue =
    editor.panel !== 'details' && download?.queue_id !== editor.base.queue_id;
  const changedSettings =
    editor.panel === 'settings' &&
    JSON.stringify(download?.finetune) !== JSON.stringify(editor.base.finetune);
  const editingStale =
    (editor.panel === 'move' || editor.panel === 'settings') &&
    (changedQueue || changedSettings);
  const validQueue =
    queueId !== undefined &&
    queueId !== download?.queue_id &&
    queues.some((queue) => queue.id === queueId);
  const validTune = fineTune && parseFineTune(fineTune).success;
  const canSave =
    !blocked &&
    !editingStale &&
    (editor.panel !== 'move' || validQueue) &&
    (editor.panel !== 'settings' || validTune);

  return (
    <WorkflowDialog
      title={title}
      description={item ? downloadName(item) : name}
      busy={busy}
      onClose={onClose}
    >
      {itemQuery.isError ? (
        <p role="alert" className="mb-3 text-[11px] text-destructive">
          {itemQuery.error.message}
        </p>
      ) : !item ? (
        <p role="status" className="text-xs text-muted-foreground">
          Loading download…
        </p>
      ) : null}
      {!editingStale &&
        (error || (editor.panel === 'details' && actionError)) && (
          <p role="alert" className="mb-3 text-[11px] text-destructive">
            {error || actionError}
          </p>
        )}
      {notice && (
        <p role="status" className="mb-3 text-[11px] text-primary">
          {notice}
        </p>
      )}
      {editor.panel === 'details' && item && download && (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 text-[11px]">
            <Detail label="Status">
              {statusLabels[statusKey(item)]}
              {typeof download.status === 'object' &&
                ` · ${download.status.Error}`}
            </Detail>
            <Detail label="Queue">
              {queues.find((queue) => queue.id === download.queue_id)?.name ??
                `Queue #${download.queue_id}`}
            </Detail>
            <Detail label="Source">
              {download.source_type === 'Http'
                ? 'HTTP(S)'
                : download.source_type}
            </Detail>
            <Detail label="Transferred">
              {formatBytes(item.completed_length)} /{' '}
              {download.size === null
                ? 'Unknown size'
                : formatBytes(download.size)}
            </Detail>
            <Detail label="Added">
              {new Date(download.created_at).toLocaleString()}
            </Detail>
            {download.started_at && (
              <Detail label="Started">
                {new Date(download.started_at).toLocaleString()}
              </Detail>
            )}
            {download.completed_at && (
              <Detail label="Completed">
                {new Date(download.completed_at).toLocaleString()}
              </Detail>
            )}
          </dl>
          <div className="mt-3 grid gap-2 border-t border-border pt-3">
            {download.url && (
              <CopyField
                label="URL"
                value={download.url}
                onCopy={() => void copy(download.url, 'URL')}
              />
            )}
            <CopyField
              label="Destination folder"
              value={download.destination_path}
              onCopy={() => void copy(download.destination_path, 'Path')}
            />
          </div>
          <div className="workflow-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={blocked}
              onClick={() => open('remove')}
            >
              Remove record
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={blocked}
              onClick={() => open('delete')}
            >
              Delete files…
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={blocked}
              onClick={() => open('move')}
            >
              Move to queue
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={blocked}
              onClick={() => open('settings')}
            >
              Settings
            </Button>
            <Button
              type="button"
              disabled={blocked || pending}
              onClick={() => action(item)}
            >
              {pending && statusKey(item) === 'Active'
                ? 'Pausing…'
                : downloadActions[statusKey(item)]}
            </Button>
          </div>
        </>
      )}
      {editor.panel !== 'details' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset className="min-w-0" disabled={blocked || editingStale}>
            {editor.panel === 'move' && (
              <label className="workflow-field">
                Destination queue
                <select
                  value={
                    queues.some((queue) => queue.id === queueId) ? queueId : ''
                  }
                  onChange={(event) => setQueueId(Number(event.target.value))}
                >
                  <option value="" disabled>
                    Choose a queue
                  </option>
                  {queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {editor.panel === 'settings' && fineTune && (
              <>
                <p className="mb-3 text-[11px] text-muted-foreground">
                  Leave fields blank to use the queue defaults. Changes apply
                  when Ario creates a new transfer for this download.
                </p>
                <FineTuneFields value={fineTune} onChange={setFineTune} />
                {!validTune && (
                  <p role="alert" className="mt-2 text-[11px] text-destructive">
                    Enter whole numbers from 0 to 4,294,967,295 or leave fields
                    blank to inherit.
                  </p>
                )}
              </>
            )}
            {editor.panel === 'remove' && (
              <p className="text-xs">
                Remove this record from Ario and keep the downloaded files.
              </p>
            )}
            {editor.panel === 'delete' && (
              <p className="text-xs">
                Permanently delete this record and its downloaded files from
                disk.
              </p>
            )}
          </fieldset>
          {editingStale && (
            <p role="alert" className="mt-2 text-[11px] text-destructive">
              The daemon changed this download while you were editing. Reload
              the form to use the current values.
            </p>
          )}
          <div className="workflow-actions">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => open('details')}
            >
              Back
            </Button>
            {editingStale ? (
              <Button
                type="button"
                disabled={blocked}
                onClick={() => open(editor.panel)}
              >
                Reload form
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!canSave}
                className={
                  editor.panel === 'delete'
                    ? 'bg-destructive text-background'
                    : undefined
                }
              >
                {busy
                  ? 'Working…'
                  : editor.panel === 'move'
                    ? 'Move download'
                    : editor.panel === 'settings'
                      ? 'Save settings'
                      : editor.panel === 'remove'
                        ? 'Remove record'
                        : 'Delete record and files'}
              </Button>
            )}
          </div>
        </form>
      )}
    </WorkflowDialog>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 wrap-anywhere">{children}</dd>
    </>
  );
}

function CopyField({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 text-[11px]">
        <p className="text-muted-foreground">{label}</p>
        <p className="select-text wrap-anywhere">{value}</p>
      </div>
      <Button type="button" variant="outline" onClick={onCopy}>
        {label === 'URL' ? 'Copy URL' : 'Copy path'}
      </Button>
    </div>
  );
}

function describeDeletion(result: DeleteFilesResult) {
  const {
    removed_payloads: removed,
    missing_payloads: missing,
    metadata_complete: complete,
  } = result;
  const files = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;
  return [
    `Record deleted. ${files(removed)} deleted.`,
    missing > 0 ? `${files(missing)} missing.` : '',
    complete ? '' : 'The daemon had incomplete file metadata.',
  ]
    .filter(Boolean)
    .join(' ');
}
