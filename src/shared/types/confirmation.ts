import { z } from 'zod';
import type { CaptureConfirmation } from './capture';

export const confirmationIdSchema = z.uuid();

export type ConfirmationOutcome =
  | { state: 'draft' | 'pending' | 'browser' | 'recovery' }
  | { state: 'committed'; downloadId: number };

export type ConfirmationDraft = {
  id: string;
  origin: string;
  url: string;
  sessionHost: string | null;
  capture?: CaptureConfirmation;
  outcome: ConfirmationOutcome;
};

export function handoffLink(raw: string | undefined): URL | null {
  if (!raw || /[\s\\\p{Cc}]/u.test(raw)) return null;
  const url = URL.parse(raw);
  if (!url) return null;

  const authority = /^https?:\/\/([^/?#]+)/i.exec(raw)?.[1];
  if (authority) {
    if (authority.includes('@') || !url.hostname || url.port === '0')
      return null;
  } else if (
    !raw.startsWith('magnet:?') ||
    !url.searchParams
      .getAll('xt')
      .some((value) =>
        /^urn:btih:(?:[\da-fA-F]{40}|[a-zA-Z2-7]{32})$/.test(value),
      )
  ) {
    return null;
  }

  url.hash = '';
  return new TextEncoder().encode(url.href).length <= 8192 ? url : null;
}
