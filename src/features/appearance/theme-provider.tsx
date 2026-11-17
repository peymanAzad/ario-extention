import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import {
  readAppearance,
  watchAppearance,
  writeAppearance,
} from '@/shared/storage/appearance';
import type { Appearance } from '@/shared/types/appearance';
import { ThemeContext } from './theme-context';

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>('system');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    let changed = false;

    const unwatch = watchAppearance((value) => {
      changed = true;
      setAppearance(value);
    });

    // A change observed during the initial read supersedes its snapshot.
    void readAppearance()
      .then((value) => {
        if (active && !changed) setAppearance(value);
      })
      .catch(() => {
        // The system preference is the fallback if browser storage is unavailable.
      })
      .finally(() => {
        if (active) setReady(true);
      });

    return () => {
      active = false;
      unwatch();
    };
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    return () => {
      delete document.documentElement.dataset.appearance;
    };
  }, [appearance]);

  return (
    <ThemeContext.Provider
      value={{ appearance, ready, setAppearance: writeAppearance }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
