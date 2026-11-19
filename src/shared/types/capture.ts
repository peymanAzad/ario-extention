import type { ImportOptions } from './download-workflows';

export type CaptureConfirmation = {
  fileName?: string;
  totalBytes?: number;
  options: ImportOptions;
  session: boolean;
  automatic: boolean;
};

export type CaptureNotice = {
  id: string;
  state: 'confirmation' | 'pending' | 'recovery';
  canDismiss?: boolean;
  fileName?: string;
};

export const browserRecoveryMessage =
  'Open your browser’s download history and resume or retry the original download.';
