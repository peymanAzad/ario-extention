import type { DashboardFilters } from '@/shared/types/dashboard';
import type { DaemonHealth, DownloadLiveStatus } from '@/shared/types/daemon';

export const categoryLabels = {
  Video: 'Video',
  Music: 'Music',
  Document: 'Documents',
  Archive: 'Archives',
  Program: 'Programs',
  Other: 'Other',
};
export const statusLabels = {
  Pending: 'Waiting',
  Active: 'Downloading',
  Paused: 'Paused',
  Completed: 'Completed',
  Error: 'Failed',
  Removed: 'Removed',
};

export function downloadName(item: DownloadLiveStatus): string {
  return (
    item.download.filename?.trim() || item.download.url || 'Unnamed download'
  );
}

export function statusKey(item: DownloadLiveStatus) {
  return typeof item.download.status === 'string'
    ? item.download.status
    : 'Error';
}

export function selectDownloads(
  items: DownloadLiveStatus[],
  filters: DashboardFilters,
): DownloadLiveStatus[] {
  const search = filters.search.trim().toLocaleLowerCase();
  const result = items.filter(
    (item) =>
      (filters.queueId === null ||
        item.download.queue_id === filters.queueId) &&
      (filters.category === null ||
        item.download.category === filters.category) &&
      (filters.status === null || statusKey(item) === filters.status) &&
      (!search ||
        downloadName(item).toLocaleLowerCase().includes(search) ||
        item.download.url.toLocaleLowerCase().includes(search)),
  );
  const direction = filters.descending ? -1 : 1;
  return result.sort((a, b) => {
    let order: number;
    switch (filters.sortBy) {
      case 'Name':
        order = downloadName(a).localeCompare(downloadName(b), undefined, {
          sensitivity: 'base',
          numeric: true,
        });
        break;
      case 'Size':
        // Unknown sizes always follow known sizes, in either direction.
        if (a.download.size === null || b.download.size === null) {
          if (a.download.size !== b.download.size)
            return a.download.size === null ? 1 : -1;
          order = 0;
        } else order = a.download.size - b.download.size;
        break;
      case 'CreatedAt':
        order =
          Date.parse(a.download.created_at) - Date.parse(b.download.created_at);
        break;
      case 'QueuePosition':
        order = a.download.position_in_queue - b.download.position_in_queue;
        break;
    }
    return direction * order || a.download.id - b.download.id;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null) return 'ETA unknown';
  if (seconds < 60) return `${seconds}s left`;
  if (seconds < 3600)
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s left`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m left`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h left`;
}

export function progressPercent(item: DownloadLiveStatus): number | undefined {
  if (statusKey(item) === 'Completed') return 100;
  if (!item.download.size) return undefined;
  return Math.min(
    100,
    Math.max(0, Math.floor((item.completed_length / item.download.size) * 100)),
  );
}

export function acquiringMetadata(item: DownloadLiveStatus): boolean {
  return (
    item.download.source_type !== 'Http' &&
    !item.download.size &&
    ['Active', 'Pending'].includes(statusKey(item))
  );
}

export function proxyStatus(health?: DaemonHealth): string {
  if (!health) return 'Proxy: unknown';
  if (health.proxy_reachable === undefined) return 'Proxy: not reported';
  if (!health.proxy_reachable) return 'Proxy: unreachable';
  if (health.proxy_data === false) return 'Proxy: no data';
  if (health.proxy_data === true) return 'Proxy: ready';
  return 'Proxy: reachable · data unchecked';
}
