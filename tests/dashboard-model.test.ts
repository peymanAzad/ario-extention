import { expect, it } from 'vitest';
import {
  acquiringMetadata,
  formatBytes,
  formatEta,
  progressPercent,
  proxyStatus,
  selectDownloads,
} from '@/features/downloads/dashboard-model';
import { defaultDashboardFilters } from '@/shared/types/dashboard';
import { dashboardDownloads, liveDownload } from './fixtures/dashboard';

it('combines queue, category, status, filename and URL search without mutating source data', () => {
  const filter = {
    ...defaultDashboardFilters,
    queueId: 2,
    category: 'Program' as const,
    status: 'Error' as const,
    search: 'INSTALLER',
  };
  expect(
    selectDownloads(dashboardDownloads, filter).map((x) => x.download.id),
  ).toEqual([5]);
  expect(
    selectDownloads(dashboardDownloads, {
      ...filter,
      search: 'EXAMPLE.TEST/FILE-5',
    }),
  ).toHaveLength(1);
  expect(
    selectDownloads(dashboardDownloads, { ...filter, queueId: 1 }),
  ).toEqual([]);
  expect(dashboardDownloads[0]?.download.id).toBe(1);
});

it.each([
  'Pending',
  'Active',
  'Paused',
  'Completed',
  'Error',
  'Removed',
] as const)('filters the %s wire status', (status) => {
  const selected = selectDownloads(dashboardDownloads, {
    ...defaultDashboardFilters,
    status,
  });
  expect(selected.length).toBe(status === 'Active' ? 2 : 1);
});

it.each(['Name', 'Size', 'CreatedAt', 'QueuePosition'] as const)(
  'sorts %s in both directions with a stable tie break and unknown sizes last',
  (sortBy) => {
    const items = [
      liveDownload(1, { filename: 'z', size: 2048, position_in_queue: 2 }),
      liveDownload(2, { filename: 'a', size: 1024, position_in_queue: 1 }),
      liveDownload(3, { filename: 'm', size: null, position_in_queue: 3 }),
    ];
    const asc = selectDownloads(items, {
      ...defaultDashboardFilters,
      sortBy,
      descending: false,
    }).map((x) => x.download.id);
    const desc = selectDownloads(items, {
      ...defaultDashboardFilters,
      sortBy,
      descending: true,
    }).map((x) => x.download.id);
    const expected =
      sortBy === 'CreatedAt'
        ? [1, 2, 3]
        : sortBy === 'Name'
          ? [2, 3, 1]
          : [2, 1, 3];
    expect(asc).toEqual(expected);
    expect(desc).toEqual(
      sortBy === 'Size' ? [1, 2, 3] : [...expected].reverse(),
    );
  },
);

it('formats unknown size/ETA, metadata, completed/zero-byte files and clamped progress truthfully', () => {
  expect(formatBytes(1024)).toBe('1 KB');
  expect(formatBytes(0)).toBe('0 B');
  expect(formatEta(null)).toBe('ETA unknown');
  expect(formatEta(0)).toBe('0s left');
  expect(formatEta(3661)).toBe('1h 1m left');
  expect(progressPercent(liveDownload(1, { size: null }))).toBeUndefined();
  expect(progressPercent(liveDownload(1, { size: 0 }))).toBeUndefined();
  expect(
    progressPercent(liveDownload(1, { size: 0, status: 'Completed' })),
  ).toBe(100);
  expect(progressPercent(liveDownload(1, { size: 1 }))).toBe(100);
  expect(
    acquiringMetadata(liveDownload(1, { size: null, source_type: 'Torrent' })),
  ).toBe(true);
  expect(
    acquiringMetadata(
      liveDownload(1, { size: null, source_type: 'Torrent', status: 'Paused' }),
    ),
  ).toBe(false);
  expect(proxyStatus()).toBe('Proxy: unknown');
});

it.each([
  [{}, 'Proxy: not reported'],
  [{ proxy_reachable: false }, 'Proxy: unreachable'],
  [{ proxy_reachable: true, proxy_data: false }, 'Proxy: no data'],
  [{ proxy_reachable: true, proxy_data: true }, 'Proxy: ready'],
  [{ proxy_reachable: true }, 'Proxy: reachable · data unchecked'],
])('distinguishes optional daemon proxy health: %o', (proxy, label) => {
  expect(
    proxyStatus({
      server: 'ok',
      aria2_reachable: true,
      tui_managed: false,
      download_speed: 0,
      active_downloads: 0,
      ...proxy,
    }),
  ).toBe(label);
});

it('sorts queue position across All Queues using the daemon’s position field', () => {
  const items = [
    liveDownload(1, { queue_id: 1, position_in_queue: 10 }),
    liveDownload(2, { queue_id: 2, position_in_queue: 1 }),
  ];
  expect(
    selectDownloads(items, {
      ...defaultDashboardFilters,
      sortBy: 'QueuePosition',
      descending: false,
    }).map((item) => item.download.id),
  ).toEqual([2, 1]);
});
