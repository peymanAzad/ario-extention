import { AppWindow, Archive, File, FileText, Film, Music2 } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { DownloadLiveStatus, Queue } from '@/shared/types/daemon';
import {
  acquiringMetadata,
  downloadName,
  formatBytes,
  formatEta,
  progressPercent,
  statusKey,
  statusLabels,
} from './dashboard-model';

export const categoryIcons = {
  Video: Film,
  Music: Music2,
  Document: FileText,
  Archive,
  Program: AppWindow,
  Other: File,
};

function DownloadRow({
  item,
  queueName,
}: {
  item: DownloadLiveStatus;
  queueName: string;
}) {
  const name = downloadName(item);
  const status = statusKey(item);
  const percent = progressPercent(item);
  const Icon = categoryIcons[item.download.category];
  const error =
    typeof item.download.status === 'object'
      ? item.download.status.Error
      : null;
  const label = acquiringMetadata(item)
    ? `${statusLabels[status]} · acquiring metadata`
    : statusLabels[status];
  return (
    <article className="download-row" aria-label={name}>
      <span className="download-file-icon">
        <Icon size={17} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium" title={name}>
          {name}
        </p>
        <div className="download-meta mt-1">
          <span
            className={
              status === 'Error'
                ? 'text-destructive'
                : status === 'Active'
                  ? 'text-primary'
                  : ''
            }
          >
            {label}
          </span>
          <span className="tabular-nums">
            {formatBytes(item.completed_length)} /{' '}
            {item.download.size === null
              ? 'Unknown size'
              : formatBytes(item.download.size)}
          </span>
        </div>
        <div className="download-meta mt-1">
          <span className="min-w-0 truncate" title={queueName}>
            {queueName}
          </span>
          <span className="shrink-0 tabular-nums">
            {formatBytes(item.download_speed)}/s · {formatEta(item.eta_seconds)}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div
            role="progressbar"
            aria-label={`${name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={
              percent === undefined ? 'Progress unknown' : `${percent}%`
            }
            className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-accent"
          >
            <span
              className={`block h-full rounded-full ${status === 'Active' || status === 'Completed' ? 'bg-primary' : status === 'Error' ? 'bg-destructive' : 'bg-muted-foreground'}`}
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <span className="w-8 text-right text-[10px] text-muted-foreground tabular-nums">
            {percent === undefined ? '—' : `${percent}%`}
          </span>
        </div>
        {error && (
          <p className="truncate text-[10px] text-destructive" title={error}>
            Error: {error}
          </p>
        )}
      </div>
    </article>
  );
}

const rowHeight = 112;
const overscan = 3;

// Fixed row heights keep DOM work bounded even for thousands of downloads.
// The focused scroll region supports native Tab access plus explicit navigation.
export function DownloadList({
  items,
  queues,
}: {
  items: DownloadLiveStatus[];
  queues: Queue[];
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(300);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const count = Math.ceil(height / rowHeight) + 2 * overscan;
  const first = Math.max(
    0,
    Math.min(
      items.length - count,
      Math.floor(scrollTop / rowHeight) - overscan,
    ),
  );
  const visible = items.slice(first, first + count);
  const queueNames = new Map(queues.map((queue) => [queue.id, queue.name]));

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    const element = viewport.current;
    if (!element || event.target !== element) return;
    const movement: Record<string, number> = {
      ArrowDown: rowHeight,
      ArrowUp: -rowHeight,
      PageDown: element.clientHeight,
      PageUp: -element.clientHeight,
      Home: -element.scrollHeight,
      End: element.scrollHeight,
    };
    const delta = movement[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    element.scrollTop += delta;
    setScrollTop(element.scrollTop);
  }

  return (
    <div
      ref={viewport}
      role="region"
      aria-label="Download list"
      tabIndex={0}
      className="download-list"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={navigate}
    >
      <ol
        aria-label="Downloads"
        className="relative m-0 list-none p-0"
        style={{ height: items.length * rowHeight }}
      >
        {visible.map((item, offset) => (
          <li
            key={item.download.id}
            aria-posinset={first + offset + 1}
            aria-setsize={items.length}
            className="absolute inset-x-0"
            style={{ top: (first + offset) * rowHeight, height: rowHeight }}
          >
            <DownloadRow
              item={item}
              queueName={
                queueNames.get(item.download.queue_id) ??
                `Queue #${item.download.queue_id}`
              }
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
