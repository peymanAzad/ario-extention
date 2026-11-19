import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  checkDaemon,
  getDaemonSettings,
  getDownloads,
  getDownload,
  getQueue,
  getQueues,
} from '@/shared/browser/messages';

export const daemonKeys = {
  origin: (origin: string) => ['daemon', origin] as const,
  health: (origin: string) => [...daemonKeys.origin(origin), 'health'] as const,
  downloads: (origin: string) =>
    [...daemonKeys.origin(origin), 'downloads'] as const,
  download: (origin: string, id: number) =>
    [...daemonKeys.origin(origin), 'download', id] as const,
  queues: (origin: string) => [...daemonKeys.origin(origin), 'queues'] as const,
  queue: (origin: string, id: number | null) =>
    [...daemonKeys.origin(origin), 'queue', id] as const,
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

export function useQueue(origin: string, id: number | null, enabled: boolean) {
  return useQuery({
    queryKey: daemonKeys.queue(origin, id),
    queryFn: ({ signal }) => getQueue(origin, id!, signal),
    enabled: enabled && id !== null,
    retry: false,
    refetchInterval: enabled && id !== null ? 1000 : false,
  });
}

export function useDownload(origin: string, id: number, enabled: boolean) {
  return useQuery({
    queryKey: daemonKeys.download(origin, id),
    queryFn: ({ signal }) => getDownload(origin, id, signal),
    enabled,
    retry: false,
    refetchInterval: 1000,
  });
}
