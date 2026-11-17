import { Layers, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { openOptions } from '@/shared/browser/runtime';
import { Button } from '@/shared/ui/button';
import { AppHeader } from '@/shared/ui/shell';

export function Popup() {
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
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Open settings"
          onClick={() => void showSettings()}
        >
          <Settings2 aria-hidden="true" />
        </Button>
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
          <p className="mt-2 text-xs text-muted-foreground">
            Download management will be available once daemon support is added.
          </p>
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
