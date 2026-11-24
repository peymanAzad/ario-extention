import { browser } from 'wxt/browser';
import { appearanceSchema } from '@/shared/types/appearance';
import {
  defaultExtensionSettings,
  extensionSettingsSchema,
  type ExtensionSettings,
  type CapturePreferences,
  type SettingsPatch,
} from '@/shared/types/settings';

import { settingsKey } from './settings-key';

const legacyAppearanceKey = 'appearance';

export async function readSettings(): Promise<ExtensionSettings> {
  const values = await browser.storage.local.get([
    settingsKey,
    legacyAppearanceKey,
  ]);
  if (values[settingsKey] !== undefined) {
    return extensionSettingsSchema.parse(values[settingsKey]);
  }
  const legacy = appearanceSchema.safeParse(values[legacyAppearanceKey]);
  return { ...defaultExtensionSettings, appearance: legacy.data ?? 'system' };
}

export function watchSettings(
  listener: (settings: ExtensionSettings) => void,
): () => void {
  let revision = 0;
  function onChanged(changes: Record<string, unknown>, area: string) {
    if (
      area !== 'local' ||
      !(settingsKey in changes || legacyAppearanceKey in changes)
    )
      return;

    const expected = ++revision;
    void readSettings()
      .then((value) => {
        if (revision === expected) listener(value);
      })
      .catch(() => {
        // Preserve the last valid settings if a storage read fails.
      });
  }

  browser.storage.onChanged.addListener(onChanged);
  return () => {
    revision++;
    browser.storage.onChanged.removeListener(onChanged);
  };
}

// Only the background writes settings. Serialize read/merge/write across open views.
let pendingWrite: Promise<void> = Promise.resolve();

export function updateSettings(
  patch: SettingsPatch & { capture?: Partial<CapturePreferences> },
): Promise<ExtensionSettings> {
  const write = pendingWrite.then(async () => {
    const current = await readSettings();
    const next = extensionSettingsSchema.parse({
      ...current,
      ...patch,
      capture: { ...current.capture, ...patch.capture },
    });
    await browser.storage.local.set({ [settingsKey]: next });
    return next;
  });
  pendingWrite = write.then(
    () => undefined,
    () => undefined,
  );
  return write;
}
