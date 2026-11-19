import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import {
  FineTuneFields,
  fineTuneInput,
  parseFineTune,
} from '@/features/downloads/fine-tune-fields';
import {
  useBrowserCapabilities,
  useDaemonHealth,
  useQueues,
} from '@/shared/api/queries';
import { capturePermissions } from '@/shared/browser/download-observation';
import {
  enableCapture,
  saveCapturePreferences,
} from '@/shared/browser/messages';
import { supportsBrowserHandoff } from '@/shared/types/browser-capabilities';
import { fineTuneSchema } from '@/shared/types/daemon';
import type {
  CapturePreferences,
  CaptureSettingsPatch,
} from '@/shared/types/settings';
import { Button } from '@/shared/ui/button';

export function CaptureSettings({
  origin,
  ready,
  preferences,
}: {
  origin: string;
  ready: boolean;
  preferences: CapturePreferences;
}) {
  const health = useDaemonHealth(origin, ready);
  const healthy = health.isSuccess;
  const capabilities = useBrowserCapabilities(origin, healthy);
  const compatible = supportsBrowserHandoff(capabilities.data);
  const queues = useQueues(origin, healthy && compatible);
  const enablement = useMutation({
    mutationFn: async ({
      enabled,
      permission,
    }: {
      enabled: boolean;
      permission?: Promise<boolean>;
    }) => {
      if (permission && !(await permission))
        throw new Error(
          'Permission was declined. Downloads will stay in the browser.',
        );
      return enableCapture(enabled);
    },
  });
  const save = useMutation({ mutationFn: saveCapturePreferences });
  const savedOverride = preferences.fineTuneOverride;
  const missingQueue =
    queues.isSuccess &&
    !queues.data.some(({ id }) => id === preferences.defaultQueueId);
  const busy = enablement.isPending || save.isPending;
  const canEnable = healthy && compatible && !capabilities.isError;

  function update(patch: CaptureSettingsPatch) {
    enablement.reset();
    save.mutate(patch);
  }

  return (
    <section
      aria-labelledby="capture-title"
      className="border-t border-border py-[19px]"
    >
      <h2 id="capture-title" className="mb-3 text-sm font-semibold">
        Browser downloads
      </h2>
      <CaptureSwitch
        label="Capture browser downloads"
        description="Send supported downloads to the local Ario daemon."
        checked={preferences.enabled}
        disabled={!ready || busy || (!preferences.enabled && !canEnable)}
        onChange={(enabled) => {
          save.reset();
          // Invoke the permission prompt within the checkbox's user gesture.
          const permission = enabled
            ? browser.permissions.request(capturePermissions).catch(() => false)
            : undefined;
          enablement.mutate({ enabled, permission });
        }}
      />
      {ready && !preferences.enabled && !canEnable && (
        <p className="mb-3 text-[11px] text-muted-foreground">
          {healthy && capabilities.isSuccess
            ? 'Upgrade the Ario daemon to enable browser downloads.'
            : 'Connect to a compatible Ario daemon to enable capture.'}
        </p>
      )}
      <CaptureSwitch
        label="Ask before downloading"
        description="Choose a queue and settings for each browser download."
        checked={preferences.askBeforeDownloading}
        disabled={!ready || busy}
        onChange={(askBeforeDownloading) => update({ askBeforeDownloading })}
      />
      <div className="my-3 grid gap-3 sm:grid-cols-2">
        <label className="workflow-field">
          Default queue
          <select
            value={preferences.defaultQueueId}
            disabled={!ready || busy || !queues.isSuccess}
            onChange={(event) =>
              update({ defaultQueueId: Number(event.target.value) })
            }
          >
            {(!queues.isSuccess || missingQueue) && (
              <option value={preferences.defaultQueueId}>
                {missingQueue
                  ? `Unavailable queue (${preferences.defaultQueueId})`
                  : preferences.defaultQueueId === 1
                    ? 'Main Queue'
                    : `Queue ${preferences.defaultQueueId}`}
              </option>
            )}
            {queues.data?.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="workflow-field">
          Default start mode
          <select
            value={preferences.startImmediately ? 'now' : 'later'}
            disabled={!ready || busy}
            onChange={(event) =>
              update({ startImmediately: event.target.value === 'now' })
            }
          >
            <option value="now">Start now</option>
            <option value="later">Save for later</option>
          </select>
        </label>
      </div>
      {missingQueue && (
        <p className="mb-3 text-[11px] text-muted-foreground">
          Ario will ask you to choose a queue for each captured download.
        </p>
      )}
      <DefaultDownloadSettings
        key={JSON.stringify(savedOverride)}
        saved={savedOverride}
        disabled={!ready || busy}
        onSave={(fineTuneOverride) => update({ fineTuneOverride })}
      />
      <CaptureSwitch
        label="Use browser session"
        description="Share cookies and referrer from the download request with the local daemon."
        checked={preferences.useBrowserSession}
        disabled={
          !ready ||
          busy ||
          (!preferences.useBrowserSession && !capabilities.data?.http_session)
        }
        onChange={(useBrowserSession) => update({ useBrowserSession })}
      />
      {(enablement.error || save.error) && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          {(enablement.error ?? save.error)?.message}
        </p>
      )}
    </section>
  );
}

function CaptureSwitch({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span>
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-1 block text-[11px] text-muted-foreground">
          {description}
        </span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="capture-switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function DefaultDownloadSettings({
  saved,
  disabled,
  onSave,
}: {
  saved: CapturePreferences['fineTuneOverride'];
  disabled: boolean;
  onSave: (value: CapturePreferences['fineTuneOverride']) => void;
}) {
  const [custom, setCustom] = useState(saved !== null);
  const [fields, setFields] = useState(() =>
    fineTuneInput(saved ?? fineTuneSchema.parse({})),
  );
  const parsed = parseFineTune(fields);
  const changed =
    saved === null || JSON.stringify(parsed.data) !== JSON.stringify(saved);

  return (
    <fieldset disabled={disabled} className="my-3 grid min-w-0 gap-3">
      <label className="workflow-field">
        Default download settings
        <select
          value={custom ? 'custom' : 'inherit'}
          onChange={(event) => {
            const override = event.target.value === 'custom';
            if (!override && saved !== null) onSave(null);
            else setCustom(override);
          }}
        >
          <option value="inherit">Use queue defaults</option>
          <option value="custom">Custom settings…</option>
        </select>
      </label>
      {custom && (
        <>
          <FineTuneFields value={fields} onChange={setFields} />
          {!parsed.success && (
            <p role="alert" className="text-xs text-destructive">
              Enter valid whole numbers or leave the fields blank to inherit.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            disabled={!parsed.success || !changed}
            onClick={() => {
              if (parsed.success) onSave(parsed.data);
            }}
          >
            Save overrides
          </Button>
        </>
      )}
    </fieldset>
  );
}
