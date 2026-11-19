import { ArioError } from '@/shared/types/connection';
import type { DashboardFilters } from '@/shared/types/dashboard';
import {
  downloadUrlSchema,
  torrentLimit,
} from '@/shared/types/download-workflows';

export const downloadActions = {
  Pending: 'Start',
  Active: 'Pause',
  Paused: 'Resume',
  Completed: 'Restart',
  Error: 'Retry',
  Removed: 'Retry',
} satisfies Record<NonNullable<DashboardFilters['status']>, string>;

const closingBrackets = new Map([
  [')', '('],
  [']', '['],
  ['}', '{'],
]);

export function extractDownloadLinks(text: string) {
  const links = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    for (const match of line.matchAll(
      /(?<![\w:/])(?:https?:\/\/|magnet:\?)[^\s<>"'`]+/gi,
    )) {
      let url = match[0];
      const start = match.index;
      const end = start + url.length;
      const opener = line.charAt(start - 1);
      const closer = line.charAt(end);
      const enclosed =
        (opener === '<' && closer === '>') ||
        (['"', "'", '`'].includes(opener) && opener === closer);
      if (!enclosed && url !== line) url = trimProsePunctuation(url);
      url = url.replace(/^magnet:/i, 'magnet:');
      if (downloadUrlSchema.safeParse(url).success) links.add(url);
    }
  }
  return [...links];
}

function trimProsePunctuation(url: string) {
  url = url.replace(/[.,;!?]+$/, '');
  for (let close = url.at(-1); close; close = url.at(-1)) {
    const open = closingBrackets.get(close);
    if (!open || url.split(close).length <= url.split(open).length) break;
    url = url.slice(0, -1);
  }
  return url;
}

export function torrentFileError(file: File) {
  if (!/^[^/\\]+\.torrent$/i.test(file.name)) return 'Choose a .torrent file.';
  if (file.size === 0) return 'The torrent file is empty.';
  if (file.size > torrentLimit)
    return 'Torrent files must be 16 MiB or smaller.';
  return null;
}

export function workflowError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The download request failed.';
}

export function importFailure(error: unknown) {
  const rejected =
    error instanceof ArioError &&
    error.detail.kind === 'http' &&
    error.detail.status !== undefined &&
    error.detail.status < 500;
  return {
    state: rejected ? ('rejected' as const) : ('unknown' as const),
    message: workflowError(error),
  };
}
