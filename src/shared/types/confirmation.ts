import { z } from 'zod';
import type { CaptureConfirmation } from './capture';

export const confirmationIdSchema = z.uuid();

export type HandoffOutcome =
  | { state: 'draft' | 'pending' | 'browser' | 'recovery' }
  | { state: 'committed'; downloadId: number };
export type ConfirmationOutcome = HandoffOutcome | { state: 'unknown' };

export type ConfirmationDraft = {
  id: string;
  origin: string;
  url: string;
  sessionHost: string | null;
  capture?: CaptureConfirmation;
  media?: true;
  outcome: ConfirmationOutcome;
};

export { handoffLink } from './links';
