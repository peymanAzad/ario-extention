import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import {
  downloadName,
  statusKey,
  statusLabels,
} from '@/features/downloads/dashboard-model';
import type { DownloadLiveStatus } from '@/shared/types/daemon';
import { sameOrder } from '@/shared/types/queue-workflows';
import { Button } from '@/shared/ui/button';

export type StagedOrder = { previous: number[]; items: DownloadLiveStatus[] };

export function QueueItems({
  items,
  staged,
  onChange,
  unavailable,
  creating,
}: {
  items?: DownloadLiveStatus[];
  staged?: StagedOrder;
  onChange: (order?: StagedOrder) => void;
  unavailable: boolean;
  creating: boolean;
}) {
  if (creating)
    return (
      <p className="text-xs text-muted-foreground">
        Create the queue to add and reorder downloads.
      </p>
    );
  if (!items)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {unavailable
          ? 'Queue downloads could not load.'
          : 'Loading queue downloads…'}
      </p>
    );
  if (!items.length && !staged)
    return (
      <p className="text-xs text-muted-foreground">This queue is empty.</p>
    );

  const live = new Map(items.map((item) => [item.download.id, item]));
  const ordered = staged?.items ?? items;

  function move(index: number, direction: -1 | 1) {
    const next = [...ordered];
    const adjacent = index + direction;
    const item = next[index];
    const neighbor = next[adjacent];
    if (!item || !neighbor) return;
    next[index] = neighbor;
    next[adjacent] = item;
    const previous =
      staged?.previous ?? ordered.map(({ download }) => download.id);
    onChange(
      sameOrder(
        next.map(({ download }) => download.id),
        previous,
      )
        ? undefined
        : { previous, items: next },
    );
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Download order determines what starts next. Select Save to apply your
          changes.
        </p>
        {staged && (
          <Button
            variant="outline"
            type="button"
            onClick={() => onChange()}
            disabled={unavailable}
          >
            Reset order
          </Button>
        )}
      </div>
      <ol>
        {ordered.map((item, index) => {
          const id = item.download.id;
          const fresh = live.get(id);
          const name = downloadName(fresh ?? item);
          return (
            <li key={id} className="queue-item">
              <GripVertical
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 truncate" title={name}>
                {name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {fresh ? statusLabels[statusKey(fresh)] : 'No longer in queue'}
              </span>
              <div className="flex shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} up`}
                  disabled={unavailable || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${name} down`}
                  disabled={unavailable || index === ordered.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
