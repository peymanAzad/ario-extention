import { queryOptions, useQuery } from '@tanstack/react-query';
import { checkDaemon, getDaemonSettings } from '@/shared/browser/messages';

export const daemonKeys = {
  origin: (origin: string) => ['daemon', origin] as const,
  health: (origin: string) => [...daemonKeys.origin(origin), 'health'] as const,
  settings: (origin: string) =>
    [...daemonKeys.origin(origin), 'settings'] as const,
};

export function healthQuery(origin: string) {
  return queryOptions({
    queryKey: daemonKeys.health(origin),
    queryFn: ({ signal }) => checkDaemon(origin, signal),
    retry: false,
  });
}

export function useDaemonHealth(origin: string, enabled: boolean) {
  return useQuery({ ...healthQuery(origin), enabled });
}

export function useDaemonSettings(origin: string) {
  return useQuery({
    queryKey: daemonKeys.settings(origin),
    queryFn: ({ signal }) => getDaemonSettings(origin, signal),
    retry: false,
  });
}
