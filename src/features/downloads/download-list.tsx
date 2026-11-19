import {
  AppWindow,
  Archive,
  Ellipsis,
  File,
  FileText,
  Film,
  Music2,
  Pause,
  Play,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { downloadActions } from './workflow-model';
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

type RowControls = {
  unavailable: boolean;
  pending: (item: DownloadLiveStatus) => boolean;
  onAction: (item: DownloadLiveStatus) => void;
  onDetails: (item: DownloadLiveStatus) => void;
};

function DownloadRow({
  item,
  queueName,
  controls,
}: {
  item: DownloadLiveStatus;
  queueName: string;
  controls: RowControls;
}) {
  const name = downloadName(item);
  const status = statusKey(item);
  const percent = progressPercent(item);
  const action = downloadActions[status];
  const ActionIcon =
    action === 'Pause' ? Pause : action === 'Retry' ? RotateCw : Play;
  const pending = controls.pending(item);
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
            {pending && status === 'Active' ? 'Pausing…' : label}
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
      <div className="flex shrink-0 gap-0.5">
        {status !== 'Completed' && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            disabled={pending || controls.unavailable}
            aria-label={`${action} ${name}`}
            title={action}
            onClick={() => controls.onAction(item)}
          >
            <ActionIcon aria-hidden="true" />
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={`Download details for ${name}`}
          title="Download details"
          onClick={() => controls.onDetails(item)}
        >
          <Ellipsis aria-hidden="true" />
        </Button>
      </div>
    </article>
  );
}

const overscan = 3;

// Fixed row heights keep DOM work bounded even for thousands of downloads.
// The focused scroll region supports native Tab access plus explicit navigation.
export function DownloadList({
  items,
  queues,
  controls,
}: {
  items: DownloadLiveStatus[];
  queues: Queue[];
  controls: RowControls;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [{ height, rowHeight }, setDimensions] = useState({
    height: 300,
    rowHeight: 96,
  });
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      const height = element.clientHeight;
      if (!height) return;
      const rowHeight = Number.parseFloat(
        getComputedStyle(element).getPropertyValue('--download-row-height'),
      );
      setDimensions({ height, rowHeight: rowHeight || 96 });
    };
    measure();
    const observer = new ResizeObserver(measure);
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
              controls={controls}
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
