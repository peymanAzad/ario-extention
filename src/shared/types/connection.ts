import { z } from 'zod';

export const extensionErrorSchema = z.object({
  kind: z.enum([
    'invalid-address',
    'unavailable',
    'timeout',
    'cancelled',
    'http',
    'invalid-response',
    'extension',
    'storage',
  ]),
  message: z.string(),
  status: z.number().optional(),
});

export type ExtensionError = z.infer<typeof extensionErrorSchema>;

export class ArioError extends Error {
  constructor(readonly detail: ExtensionError) {
    super(detail.message);
    this.name = 'ArioError';
  }
}

export const cancelled = {
  kind: 'cancelled',
  message: 'The request was cancelled.',
} as const satisfies ExtensionError;
