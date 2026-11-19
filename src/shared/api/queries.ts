import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  checkDaemon,
  getDaemonSettings,
  getDownloads,
  getQueues,
} from '@/shared/browser/messages';

export const daemonKeys = {
  origin: (origin: string) => ['daemon', origin] as const,
  health: (origin: string) => [...daemonKeys.origin(origin), 'health'] as const,
  downloads: (origin: string) =>
    [...daemonKeys.origin(origin), 'downloads'] as const,
  queues: (origin: string) => [...daemonKeys.origin(origin), 'queues'] as const,
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

export function useDaemonHealth(
  origin: string,
  enabled: boolean,
  poll = false,
) {
  return useQuery({
    ...healthQuery(origin),
    enabled,
    refetchInterval: poll ? 1000 : false,
  });
}

export function useDaemonSettings(origin: string) {
  return useQuery({
    queryKey: daemonKeys.settings(origin),
    queryFn: ({ signal }) => getDaemonSettings(origin, signal),
    retry: false,
  });
}

export function useDownloads(origin: string, enabled: boolean) {
  return useQuery({
    queryKey: daemonKeys.downloads(origin),
    queryFn: ({ signal }) => getDownloads(origin, signal),
    enabled,
    retry: false,
    refetchInterval: 1000,
  });
}

export function useQueues(origin: string, enabled: boolean) {
  return useQuery({
    queryKey: daemonKeys.queues(origin),
    queryFn: ({ signal }) => getQueues(origin, signal),
    enabled,
    retry: false,
    refetchInterval: 1000,
  });
}
