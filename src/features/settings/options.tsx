import { AppHeader } from '@/shared/ui/shell';
import { useMutation } from '@tanstack/react-query';
import { saveSettings } from '@/shared/browser/messages';
import { AppearanceSettings } from './appearance';
import { CaptureSettings } from './capture-settings';
import { ConnectionSettings } from './connection-form';
import { useExtensionSettings } from './settings-context';

export function Options() {
  const { settings, ready, loadFailed } = useExtensionSettings();
  const { origin } = settings.connection;
  const media = useMutation({ mutationFn: saveSettings });

  return (
    <div className="mx-auto min-h-dvh max-w-[780px] border-x border-border bg-background">
      <AppHeader />
      <main className="mx-auto max-w-[690px] px-8 py-6 max-[580px]:px-[18px]">
        <h1 className="mb-5">Settings</h1>
        {loadFailed && (
          <p role="alert" className="mb-4 text-xs text-destructive">
            Could not read extension settings.
          </p>
        )}
        <ConnectionSettings key={origin} origin={origin} ready={ready} />
        <CaptureSettings
          key={`capture-${origin}`}
          origin={origin}
          ready={ready}
          preferences={settings.capture}
        />
        <section
          aria-labelledby="media-settings"
          className="border-t border-border py-[19px]"
        >
          <h2 id="media-settings" className="mb-3 text-sm font-semibold">
            Media
          </h2>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              role="switch"
              aria-describedby="media-settings-description"
              checked={settings.detectMedia}
              disabled={!ready || media.isPending}
              onChange={(event) =>
                media.mutate({ detectMedia: event.target.checked })
              }
            />
            Detect media
          </label>
          <p
            id="media-settings-description"
            className="mt-1 text-[11px] text-muted-foreground"
          >
            Find supported video and audio files and show a download button
            beside their players.
          </p>
          {media.isError && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {media.error.message}
            </p>
          )}
        </section>
        <AppearanceSettings />
      </main>
    </div>
  );
}
