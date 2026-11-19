import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { daemonKeys } from '@/shared/api/queries';
import {
  saveDownloadDraft,
  uploadTorrent,
  writeDownload,
} from '@/shared/browser/messages';
import { readDownloadDraft } from '@/shared/storage/download-draft';
import {
  fineTuneSchema,
  type DownloadLiveStatus,
  type Queue,
} from '@/shared/types/daemon';
import type { ImportOptions } from '@/shared/types/download-workflows';
import { Button } from '@/shared/ui/button';
import {
  FineTuneFields,
  fineTuneInput,
  parseFineTune,
} from './fine-tune-fields';
import {
  extractDownloadLinks,
  importFailure,
  torrentFileError,
} from './workflow-model';
import { WorkflowDialog } from './workflow-dialog';

type Outcome =
  { state: 'added'; message: string } | ReturnType<typeof importFailure>;

function added(result: DownloadLiveStatus): Outcome {
  const { status } = result.download;
  return {
    state: 'added',
    message:
      typeof status === 'object'
        ? `Added · transfer failed: ${status.Error}`
        : 'Added',
  };
}

export function AddDownloadDialog({
  origin,
  queues,
  initialQueueId,
  unavailable,
  onClose,
  onAdded,
}: {
  origin: string;
  queues: Queue[];
  initialQueueId: number | null;
  unavailable: boolean;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'links' | 'torrent'>('links');
  const [queueId, setQueueId] = useState(initialQueueId);
  const [override, setOverride] = useState(false);
  const [fineTune, setFineTune] = useState(() =>
    fineTuneInput(fineTuneSchema.parse({})),
  );
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [text, setText] = useState('');
  const [excluded, setExcluded] = useState(new Set<string>());
  const [outcomes, setOutcomes] = useState(new Map<string, Outcome>());
  const [file, setFile] = useState<File>();
  const [fileOutcome, setFileOutcome] = useState<Outcome>();
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState('');
  const submitting = useRef(false);

  useEffect(() => {
    let current = true;
    void readDownloadDraft(origin)
      .then((saved) => {
        if (!current || !saved) return;
        setQueueId(saved.queueId);
        setOverride(saved.override);
        setFineTune(fineTuneInput(saved.fineTune));
      })
      .catch(() => {
        if (current) setStorageError(true);
      })
      .finally(() => {
        if (current) setReady(true);
      });
    return () => {
      current = false;
    };
  }, [origin]);

  function remember(
    nextQueue: number | null,
    nextOverride: boolean,
    nextTune: typeof fineTune,
  ) {
    const parsed = parseFineTune(nextTune);
    if (!parsed.success) return;
    void saveDownloadDraft({
      origin,
      queueId: nextQueue,
      override: nextOverride,
      fineTune: parsed.data,
    }).then(
      () => setStorageError(false),
      () => setStorageError(true),
    );
  }

  const links = useMemo(() => extractDownloadLinks(text), [text]);
  const selected = links.filter((link) => {
    const state = outcomes.get(link)?.state;
    return !excluded.has(link) && state !== 'added' && state !== 'unknown';
  });
  const queue = queues.find((candidate) => candidate.id === queueId);
  const parsed = parseFineTune(fineTune);
  const fileError = file ? torrentFileError(file) : null;
  const validSource =
    mode === 'links'
      ? selected.length > 0
      : file &&
        !fileError &&
        (!fileOutcome || fileOutcome.state === 'rejected');
  const canSubmit =
    ready &&
    !busy &&
    !unavailable &&
    queue &&
    validSource &&
    (!override || parsed.success);

  async function submit(startImmediately: boolean) {
    if (submitting.current || !canSubmit || !queue) return;
    const options: ImportOptions = {
      queue_id: queue.id,
      finetune_override: override ? (parsed.data ?? null) : null,
      start_immediately: startImmediately,
    };
    submitting.current = true;
    setBusy(true);
    setSummary('');
    let finished = false;
    try {
      if (mode === 'torrent' && file) {
        try {
          const outcome = added(await uploadTorrent(origin, file, options));
          setFileOutcome(outcome);
          finished = outcome.message === 'Added';
          if (finished) onAdded('Torrent added.');
        } catch (error) {
          setFileOutcome(importFailure(error));
        }
        return;
      }

      const retrySelection = new Set(excluded);
      const result = new Map(outcomes);
      let count = 0;
      for (const link of selected) {
        let outcome: Outcome;
        try {
          outcome = added(
            await writeDownload('daemon.download.add', {
              origin,
              url: link,
              options,
            }),
          );
          count += 1;
        } catch (error) {
          outcome = importFailure(error);
          retrySelection.add(link);
        }
        result.set(link, outcome);
        setOutcomes(new Map(result));
      }
      setExcluded(retrySelection);
      const label =
        count === 1 ? '1 download added.' : `${count} downloads added.`;
      finished = links.every((link) => result.get(link)?.message === 'Added');
      if (finished) onAdded(label);
      else setSummary(label);
    } finally {
      void queryClient.invalidateQueries({
        queryKey: daemonKeys.origin(origin),
      });
      submitting.current = false;
      if (!finished) setBusy(false);
    }
  }

  return (
    <WorkflowDialog
      title="Add downloads"
      description="Paste HTTP(S) links or magnets, or choose a torrent file."
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(true);
        }}
      >
        <fieldset disabled={!ready || busy} className="grid min-w-0 gap-3">
          <div
            role="group"
            aria-label="Source"
            className="flex gap-1 rounded-md border border-border bg-sidebar p-0.5"
          >
            {(['links', 'torrent'] as const).map((source) => (
              <Button
                key={source}
                type="button"
                variant={mode === source ? 'outline' : 'ghost'}
                aria-pressed={mode === source}
                onClick={() => setMode(source)}
              >
                {source === 'links' ? 'Links' : 'Torrent file'}
              </Button>
            ))}
          </div>
          {mode === 'links' ? (
            <>
              <label className="workflow-field">
                Download links
                <textarea
                  rows={3}
                  placeholder="https://example.com/file.zip"
                  spellCheck={false}
                  autoComplete="off"
                  value={text}
                  onChange={(event) => {
                    setText(event.target.value);
                    setSummary('');
                  }}
                  className="resize-y"
                />
              </label>
              {text.trim() && links.length === 0 && (
                <p className="text-[11px] text-destructive">
                  No HTTP(S) links or magnets found.
                </p>
              )}
              {links.length > 0 && (
                <fieldset className="min-w-0">
                  <legend className="mb-1.5 text-[11px] text-muted-foreground">
                    {selected.length} of {links.length} selected
                  </legend>
                  <ul className="max-h-32 overflow-auto rounded-md border border-border bg-sidebar px-2.5">
                    {links.map((link) => {
                      const outcome = outcomes.get(link);
                      const locked =
                        outcome?.state === 'added' ||
                        outcome?.state === 'unknown';
                      return (
                        <li
                          key={link}
                          className="border-b border-border py-1.5 last:border-0"
                        >
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={!locked && !excluded.has(link)}
                              disabled={locked}
                              onChange={(event) => {
                                const next = new Set(excluded);
                                if (event.target.checked) next.delete(link);
                                else next.add(link);
                                setExcluded(next);
                              }}
                              className="mt-0.5 accent-primary"
                            />
                            <span className="text-[11px] break-all">
                              {link}
                            </span>
                          </label>
                          {outcome && <ImportResult outcome={outcome} />}
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}
            </>
          ) : (
            <>
              <label className="workflow-field">
                Torrent file
                <input
                  type="file"
                  accept=".torrent,application/x-bittorrent"
                  onChange={(event) => {
                    setFile(event.target.files?.[0]);
                    setFileOutcome(undefined);
                  }}
                />
              </label>
              {fileError && (
                <p role="alert" className="text-[11px] text-destructive">
                  {fileError}
                </p>
              )}
              {fileOutcome && <ImportResult outcome={fileOutcome} />}
              {file && !fileError && (
                <p className="text-[11px] break-all text-muted-foreground">
                  {file.name}
                </p>
              )}
            </>
          )}
          <label className="workflow-field">
            Queue
            <select
              value={queue?.id ?? ''}
              onChange={(event) => {
                const next = Number(event.target.value) || null;
                setQueueId(next);
                remember(next, override, fineTune);
              }}
            >
              <option value="" disabled>
                Choose a queue
              </option>
              {queues.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="workflow-field">
            Download settings
            <select
              value={override ? 'override' : 'default'}
              onChange={(event) => {
                const next = event.target.value === 'override';
                setOverride(next);
                remember(queueId, next, fineTune);
              }}
            >
              <option value="default">Use queue defaults</option>
              <option value="override">Customize settings</option>
            </select>
          </label>
          {override && (
            <>
              <FineTuneFields
                value={fineTune}
                onChange={(next) => {
                  setFineTune(next);
                  remember(queueId, true, next);
                }}
              />
              {!parsed.success && (
                <p role="alert" className="text-[11px] text-destructive">
                  Enter whole numbers from 0 to 4,294,967,295 or leave fields
                  blank to inherit.
                </p>
              )}
            </>
          )}
        </fieldset>
        {storageError && (
          <p role="alert" className="mt-3 text-[11px] text-destructive">
            Could not remember your queue and settings draft.
          </p>
        )}
        {unavailable && (
          <p className="mt-3 text-[11px] text-destructive">
            Reconnect to the daemon to add downloads.
          </p>
        )}
        {summary && (
          <p role="status" className="mt-3 text-[11px]">
            {summary}
          </p>
        )}
        <div className="workflow-actions">
          <Button
            type="button"
            variant="outline"
            disabled={!canSubmit}
            onClick={() => void submit(false)}
          >
            Save for later
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {busy ? 'Adding…' : 'Start now'}
          </Button>
        </div>
      </form>
    </WorkflowDialog>
  );
}

function ImportResult({ outcome }: { outcome: Outcome }) {
  return (
    <p
      className={`mt-1 text-[11px] break-words ${outcome.message === 'Added' ? 'text-primary' : 'text-destructive'}`}
    >
      {outcome.state === 'unknown' &&
        'Could not verify whether it was added. Check the dashboard before trying again. '}
      {outcome.state === 'rejected' && 'Failed · '}
      {outcome.message}
    </p>
  );
}
