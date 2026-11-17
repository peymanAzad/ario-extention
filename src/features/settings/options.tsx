import { AppHeader } from '@/shared/ui/shell';
import { AppearanceSettings } from './appearance';
import { ConnectionSettings } from './connection-form';
import { useExtensionSettings } from './settings-context';

export function Options() {
  const { settings, ready, loadFailed } = useExtensionSettings();
  const { origin } = settings.connection;

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
        <AppearanceSettings />
      </main>
    </div>
  );
}
