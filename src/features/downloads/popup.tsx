import { Layers, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useDaemonHealth } from '@/shared/api/queries';
import { ConnectionStatus } from '@/features/connection/connection-status';
import { useExtensionSettings } from '@/features/settings/settings-context';
import { openOptions } from '@/shared/browser/runtime';
import { Button } from '@/shared/ui/button';
import { AppHeader } from '@/shared/ui/shell';

export function Popup() {
  const { settings, ready, loadFailed } = useExtensionSettings();
  const health = useDaemonHealth(settings.connection.origin, ready);
  const canReconnect = health.isError || health.data?.aria2_reachable === false;
  const [settingsError, setSettingsError] = useState(false);

  async function showSettings() {
    setSettingsError(false);
    try {
      await openOptions();
    } catch {
      setSettingsError(true);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <AppHeader>
        <div className="flex min-w-0 items-center gap-2">
          {ready && (
            <ConnectionStatus
              compact
              checking={health.isFetching}
              health={health.data}
              error={health.error}
            />
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="Open settings"
            onClick={() => void showSettings()}
          >
            <Settings2 aria-hidden="true" />
          </Button>
        </div>
      </AppHeader>
      <div className="grid min-h-0 flex-1 grid-cols-[155px_minmax(0,1fr)] max-[580px]:grid-cols-[125px_minmax(0,1fr)] max-[340px]:grid-cols-1 max-[340px]:grid-rows-[auto_minmax(0,1fr)]">
        <aside
          aria-label="Library"
          className="overflow-y-auto border-r border-border bg-sidebar px-2.5 py-[18px] max-[580px]:px-1.5 max-[340px]:border-r-0 max-[340px]:border-b max-[340px]:py-2"
        >
          <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase max-[340px]:sr-only">
            Library
          </p>
          <p className="flex items-center gap-2 rounded-sm bg-accent px-2 py-2 text-xs font-medium">
            <Layers size={14} className="shrink-0" aria-hidden="true" />
            All downloads
          </p>
        </aside>
        <main className="overflow-y-auto px-[22px] py-[22px] max-[580px]:px-3.5">
          <h1>Downloads</h1>
          {health.error && (
            <p className="mt-2 text-xs text-muted-foreground">
              {health.error.message}
            </p>
          )}
          {canReconnect && (
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              disabled={health.isFetching}
              onClick={() => void health.refetch()}
            >
              Reconnect
            </Button>
          )}
          {loadFailed && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              Could not read extension settings.
            </p>
          )}
          {settingsError && (
            <p role="alert" className="mt-3 text-xs text-destructive">
              Settings could not open. Try again from the toolbar or the
              browser’s extensions page.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
