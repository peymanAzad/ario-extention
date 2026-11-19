import {
  downloadLiveStatusSchema,
  queueSchema,
  type DownloadLiveStatus,
} from '@/shared/types/daemon';

export const mainQueue = queueSchema.parse({
  id: 1,
  name: 'Main Queue',
  position: 0,
  settings: {
    max_concurrent_downloads: 2,
    max_retries: 3,
    default_finetune: {},
  },
  scheduler: {
    enabled: false,
    run_missed_on_startup: false,
    recurrence: {
      Once: { start: '2026-11-19T00:00:00Z', end: '2026-11-20T00:00:00Z' },
    },
  },
  created_at: '2026-11-19T00:00:00Z',
  status: 'Active',
});
export const nightQueue = {
  ...mainQueue,
  id: 2,
  name: 'Night shift',
  position: 1,
  status: 'Paused' as const,
};

export function liveDownload(
  id: number,
  patch: Partial<DownloadLiveStatus['download']> = {},
  live: Partial<Omit<DownloadLiveStatus, 'download'>> = {},
): DownloadLiveStatus {
  return downloadLiveStatusSchema.parse({
    download: {
      id,
      url: `https://example.test/file-${id}.bin`,
      filename: `file-${id}.bin`,
      destination_path: '/tmp',
      source_type: 'Http',
      category: 'Other',
      status: 'Active',
      paused_by_scheduler: false,
      manually_started: false,
      size: 1024,
      queue_id: 1,
      position_in_queue: id,
      finetune: {},
      created_at: `2026-11-19T00:00:${String(id % 60).padStart(2, '0')}Z`,
      ...patch,
    },
    completed_length: 512,
    download_speed: 128,
    eta_seconds: 4,
    ...live,
  });
}

export const dashboardDownloads = [
  liveDownload(1, { filename: 'Movie.mp4', category: 'Video' }),
  liveDownload(2, {
    filename: 'Song.flac',
    category: 'Music',
    status: 'Paused',
  }),
  liveDownload(3, {
    filename: 'Report.pdf',
    category: 'Document',
    status: 'Completed',
  }),
  liveDownload(4, {
    filename: 'Backup.zip',
    category: 'Archive',
    status: 'Pending',
    queue_id: 2,
  }),
  liveDownload(5, {
    filename: 'Installer.bin',
    category: 'Program',
    status: { Error: 'Tracker refused connection' },
    queue_id: 2,
  }),
  liveDownload(6, { filename: 'Removed.bin', status: 'Removed' }),
  liveDownload(7, {
    filename: null,
    source_type: 'Magnet',
    url: 'magnet:?xt=urn:btih:test',
    size: null,
  }),
];
