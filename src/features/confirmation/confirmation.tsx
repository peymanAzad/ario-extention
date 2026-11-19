import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, CircleCheck, File, Magnet } from 'lucide-react';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  FineTuneFields,
  fineTuneInput,
  parseFineTune,
} from '@/features/downloads/fine-tune-fields';
import { useBrowserCapabilities, useQueues } from '@/shared/api/queries';
import { sessionPermissions } from '@/shared/browser/browser-session';
import {
  checkConfirmation,
  getConfirmation,
  submitConfirmation,
} from '@/shared/browser/messages';
import { openOptions } from '@/shared/browser/runtime';
import { supportsBrowserHandoff } from '@/shared/types/browser-capabilities';
import {
  confirmationIdSchema,
  type ConfirmationDraft,
} from '@/shared/types/confirmation';
import { fineTuneSchema } from '@/shared/types/daemon';
import type { ImportOptions } from '@/shared/types/download-workflows';
import { mainQueueId } from '@/shared/types/queue-workflows';
import { Button } from '@/shared/ui/button';
import { Brand } from '@/shared/ui/shell';

const confirmationKey = (id: string) => ['confirmation', id] as const;
const closeWindow = () => window.close();

function linkName(url: URL) {
  if (url.protocol === 'magnet:')
    return url.searchParams.get('dn')?.trim() || 'Magnet link';
  const name = url.pathname.split('/').filter(Boolean).at(-1);
  if (!name) return url.hostname;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function Confirmation({
  hash = window.location.hash,
}: {
  hash?: string;
}) {
  const id = confirmationIdSchema.safeParse(hash.slice(1)).data;
  const draft = useQuery({
    queryKey: confirmationKey(id ?? ''),
    queryFn: () => getConfirmation(id!),
    enabled: Boolean(id),
    retry: false,
    staleTime: Infinity,
  });

  return (
    <main className="grid min-h-dvh place-items-center bg-muted p-3 sm:p-6">
      <section
        aria-labelledby="confirmation-title"
        className="w-full min-w-0 max-w-[450px] rounded-xl border border-border bg-background p-5 shadow-sm sm:p-6"
      >
        <div className="mb-6 flex items-center justify-between gap-3">
          <Brand />
          <span className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground">
            Browser link
          </span>
        </div>
        <h1 id="confirmation-title">Download with Ario</h1>
        {draft.data ? (
          <ConfirmationForm key={draft.data.id} draft={draft.data} />
        ) : (
          <>
            <p
              className="mt-2 text-xs text-muted-foreground"
              role={draft.isError ? 'alert' : 'status'}
            >
              {id && draft.isPending
                ? 'Opening download confirmation…'
                : draft.isError
                  ? draft.error.message
                  : 'This confirmation has expired. Right-click the link to open a new one.'}
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={closeWindow}>
                Back to browser
              </Button>
              {draft.isError && (
                <Button type="button" onClick={() => void draft.refetch()}>
                  Try again
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function ConfirmationForm({ draft }: { draft: ConfirmationDraft }) {
  const { id, origin, outcome, sessionHost } = draft;
  const queryClient = useQueryClient();
  const capabilities = useBrowserCapabilities(
    origin,
    outcome.state === 'draft',
  );
  const supported = supportsBrowserHandoff(capabilities.data);
  const queues = useQueues(origin, supported && outcome.state === 'draft');
  const [selectedQueue, setSelectedQueue] = useState<number>();
  const [override, setOverride] = useState(false);
  const [fields, setFields] = useState(() =>
    fineTuneInput(fineTuneSchema.parse({})),
  );
  const [session, setSession] = useState<
    'off' | 'requesting' | 'on' | 'denied'
  >('off');
  const url = new URL(draft.url);
  const magnet = url.protocol === 'magnet:';
  const FileIcon = magnet ? Magnet : File;
  const queueId = queues.data?.some(
    ({ id }) => id === (selectedQueue ?? mainQueueId),
  )
    ? (selectedQueue ?? mainQueueId)
    : undefined;
  const fineTune = parseFineTune(fields);
  const useSession = session === 'on';

  const submission = useMutation({
    mutationFn: (options: ImportOptions | null) =>
      options
        ? submitConfirmation(id, options, useSession)
        : checkConfirmation(id),
    onSuccess: (next) => {
      queryClient.setQueryData(confirmationKey(id), {
        ...draft,
        outcome: next,
      });
    },
    onError: () =>
      void queryClient.invalidateQueries({ queryKey: confirmationKey(id) }),
  });

  async function toggleSession(enabled: boolean) {
    if (!enabled || !sessionHost) {
      setSession('off');
      return;
    }
    setSession('requesting');
    const granted = await browser.permissions
      .request(sessionPermissions(sessionHost))
      .catch(() => false);
    setSession(granted ? 'on' : 'denied');
  }

  function send(startImmediately: boolean) {
    if (!queueId || (override && !fineTune.success) || submission.isPending)
      return;
    submission.mutate({
      queue_id: queueId,
      finetune_override: override && fineTune.success ? fineTune.data : null,
      start_immediately: startImmediately,
    });
  }

  const problem = capabilities.error ?? queues.error;
  const loading = capabilities.isFetching || (supported && queues.isPending);

  return (
    <>
      {outcome.state === 'draft' && (
        <p className="mt-1 text-xs text-muted-foreground">
          Choose where this download goes.
        </p>
      )}
      <div className="my-4 flex items-center gap-3 border-y border-border py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
          <FileIcon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium" title={linkName(url)}>
            <bdi>{linkName(url)}</bdi>
          </p>
          <p
            className="mt-1 max-h-16 overflow-auto wrap-anywhere text-[11px] text-muted-foreground"
            tabIndex={0}
          >
            <bdi>{draft.url}</bdi>
          </p>
        </div>
      </div>

      {submission.error && (
        <p role="alert" className="mb-3 text-xs text-destructive">
          {submission.error.message}
        </p>
      )}
      {outcome.state === 'committed' ? (
        <>
          <p role="status" className="flex items-center gap-2 text-xs">
            <CircleCheck className="size-4 text-primary" aria-hidden="true" />{' '}
            Added to Ario.
          </p>
          <div className="mt-6 flex justify-end">
            <Button type="button" onClick={closeWindow}>
              Close
            </Button>
          </div>
        </>
      ) : outcome.state === 'pending' ? (
        <>
          <p role="status" className="text-xs text-muted-foreground">
            Ario is still confirming this submission. Check its status before
            trying again.
          </p>
          <div className="mt-6 flex flex-wrap justify-between gap-2">
            <Button type="button" variant="ghost" onClick={closeWindow}>
              Back to browser
            </Button>
            <Button
              type="button"
              disabled={submission.isPending}
              onClick={() => submission.mutate(null)}
            >
              Check status
            </Button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send(true);
          }}
        >
          {problem ? (
            <p role="alert" className="text-xs text-destructive">
              {problem.message}
            </p>
          ) : loading ? (
            <p role="status" className="text-xs text-muted-foreground">
              Checking the Ario daemon…
            </p>
          ) : !supported ? (
            <p role="alert" className="text-xs text-destructive">
              Upgrade the Ario daemon to a version that supports browser
              downloads.
            </p>
          ) : (
            <fieldset
              disabled={submission.isPending || session === 'requesting'}
              className="grid min-w-0 gap-4"
            >
              <div className="workflow-field">
                <label htmlFor="confirmation-queue">Queue</label>
                <select
                  id="confirmation-queue"
                  value={queueId ?? ''}
                  onChange={(event) =>
                    setSelectedQueue(Number(event.target.value))
                  }
                >
                  <option value="" disabled>
                    {queues.data?.length
                      ? 'Choose a queue'
                      : 'No queues available'}
                  </option>
                  {queues.data?.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="workflow-field">
                <label htmlFor="confirmation-settings">Download settings</label>
                <select
                  id="confirmation-settings"
                  value={override ? 'custom' : 'inherit'}
                  onChange={(event) =>
                    setOverride(event.target.value === 'custom')
                  }
                >
                  <option value="inherit">Use queue defaults</option>
                  <option value="custom">Custom settings…</option>
                </select>
              </div>
              {override && (
                <FineTuneFields value={fields} onChange={setFields} />
              )}
              {override && !fineTune.success && (
                <p role="alert" className="text-xs text-destructive">
                  Enter valid whole numbers or leave the fields blank to
                  inherit.
                </p>
              )}
              {!magnet && (
                <div>
                  <label className="flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={useSession}
                      disabled={
                        !sessionHost || !capabilities.data?.http_session
                      }
                      aria-describedby="browser-session-help"
                      onChange={(event) =>
                        void toggleSession(event.target.checked)
                      }
                    />
                    Use browser session
                  </label>
                  <p
                    id="browser-session-help"
                    className="mt-1 pl-5 text-[11px] text-muted-foreground"
                    aria-live="polite"
                  >
                    {session === 'denied'
                      ? 'Cookie access was denied. You can send the public link or go back to the browser.'
                      : !sessionHost
                        ? 'This link’s browser session could not be identified. You can send the public link or go back to the browser.'
                        : !capabilities.data?.http_session
                          ? 'This daemon only supports public links.'
                          : 'Share cookies for this direct link with the local Ario daemon.'}
                  </p>
                </div>
              )}
            </fieldset>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="px-0"
              disabled={submission.isPending}
              onClick={closeWindow}
            >
              Back to browser
            </Button>
            {problem ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openOptions()}
                >
                  Settings
                </Button>
                <Button
                  type="button"
                  onClick={() =>
                    void (capabilities.isError
                      ? capabilities.refetch()
                      : queues.refetch())
                  }
                >
                  Try again
                </Button>
              </div>
            ) : (
              supported &&
              !loading && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !queueId ||
                      (override && !fineTune.success) ||
                      submission.isPending ||
                      session === 'requesting'
                    }
                    onClick={() => send(false)}
                  >
                    Save for later
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      !queueId ||
                      (override && !fineTune.success) ||
                      submission.isPending ||
                      session === 'requesting'
                    }
                  >
                    <ArrowDown aria-hidden="true" />{' '}
                    {submission.isPending ? 'Sending…' : 'Start now'}
                  </Button>
                </div>
              )
            )}
          </div>
        </form>
      )}
    </>
  );
}
