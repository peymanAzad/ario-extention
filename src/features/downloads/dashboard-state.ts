import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { readDashboardFilters } from '@/shared/storage/dashboard';
import { saveDashboardFilters } from '@/shared/browser/messages';
import {
  defaultDashboardFilters,
  type DashboardFilters,
} from '@/shared/types/dashboard';

function subscribeVisible(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

export function usePageVisible() {
  return useSyncExternalStore(
    subscribeVisible,
    () => document.visibilityState !== 'hidden',
  );
}

export function useDashboardFilters() {
  const [filters, setFilters] = useState(defaultDashboardFilters);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let alive = true;
    void readDashboardFilters()
      .then((value) => {
        if (alive) {
          setFilters(value);
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setStorageError(true);
          setReady(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = useCallback(
    (patch: Partial<DashboardFilters>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      void saveDashboardFilters(next)
        .then(() => setStorageError(false))
        .catch(() => setStorageError(true));
    },
    [filters],
  );
  return { filters, ready, storageError, update };
}
