import { useState } from 'react';
import type { Appearance } from '@/shared/types/appearance';
import { saveSettings } from '@/shared/browser/messages';
import { useExtensionSettings } from './settings-context';

const choices: Array<{ value: Appearance; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function AppearanceSettings() {
  const {
    settings: { appearance },
    ready,
  } = useExtensionSettings();
  const [saveError, setSaveError] = useState(false);

  async function save(value: Appearance) {
    setSaveError(false);
    try {
      await saveSettings({ appearance: value });
    } catch {
      setSaveError(true);
    }
  }

  return (
    <section
      aria-labelledby="appearance-title"
      className="border-t border-border py-[19px]"
    >
      <h2 id="appearance-title" className="text-sm font-semibold">
        Appearance
      </h2>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="theme-label" className="font-medium">
            Theme
          </p>
          <p
            id="theme-description"
            className="mt-1 text-xs text-muted-foreground"
          >
            System follows your device’s appearance.
          </p>
        </div>
        <fieldset
          aria-labelledby="theme-label"
          aria-describedby="theme-description"
          disabled={!ready}
          className="inline-flex rounded-md border border-border bg-sidebar p-0.5 disabled:opacity-60"
        >
          {choices.map(({ value, label }) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name="appearance"
                value={value}
                checked={appearance === value}
                onChange={() => void save(value)}
                className="peer sr-only"
              />
              <span className="block rounded-sm px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent peer-checked:bg-accent peer-checked:font-medium peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-ring">
                {label}
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      {saveError && (
        <p role="alert" className="mt-3 text-xs text-destructive">
          The theme could not be saved. Try selecting it again.
        </p>
      )}
    </section>
  );
}
