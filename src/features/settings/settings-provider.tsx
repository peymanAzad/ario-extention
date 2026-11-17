import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { readSettings, watchSettings } from '@/shared/storage/settings';
import { defaultExtensionSettings } from '@/shared/types/settings';
import { SettingsContext } from './settings-context';

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(defaultExtensionSettings);
  const [ready, setReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let changed = false;

    const unwatch = watchSettings((value) => {
      changed = true;
      setSettings(value);
      setLoadFailed(false);
      setReady(true);
    });

    // A storage change observed during the initial read supersedes its snapshot.
    void readSettings()
      .then((value) => {
        if (active && !changed) {
          setSettings(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (active && !changed) setLoadFailed(true);
      });

    return () => {
      active = false;
      unwatch();
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = settings.appearance;
    return () => {
      delete document.documentElement.dataset.appearance;
    };
  }, [settings.appearance]);

  return (
    <SettingsContext.Provider value={{ settings, ready, loadFailed }}>
      {children}
    </SettingsContext.Provider>
  );
}
