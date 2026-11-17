import { z } from 'zod';
import { daemonAddressHint, parseDaemonOrigin } from './endpoint';
import { ArioError, cancelled } from '@/shared/types/connection';

const structuredError = z.object({
  result: z.literal('error'),
  message: z.string().trim().min(1),
});

type RequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
};

export function requestDaemon<T>(
  address: string,
  path: `/${string}`,
  expected: z.ZodType<T>,
  options?: RequestOptions,
): Promise<T>;
export function requestDaemon(
  address: string,
  path: `/${string}`,
  expected: 'empty',
  options?: RequestOptions,
): Promise<void>;
export async function requestDaemon<T>(
  address: string,
  path: `/${string}`,
  expected: z.ZodType<T> | 'empty',
  { signal, timeoutMs = 5000, method = 'GET' }: RequestOptions = {},
): Promise<T | void> {
  const origin = parseDaemonOrigin(address);
  if (!origin)
    throw new ArioError({
      kind: 'invalid-address',
      message: daemonAddressHint,
    });

  const timeout = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  let body: string;
  try {
    response = await fetch(`${origin}${path}`, {
      method,
      signal: requestSignal,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    body = await response.text();
  } catch {
    if (requestSignal.aborted) {
      if (requestSignal.reason === timeout.reason) {
        throw new ArioError({
          kind: 'timeout',
          message: 'The daemon did not respond in time.',
        });
      }
      throw new ArioError(cancelled);
    }
    throw new ArioError({
      kind: 'unavailable',
      message:
        'Could not reach the Ario daemon. Check that it is running at this address.',
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    // Empty replies and non-JSON errors are handled according to the route.
  }
  if (!response.ok) {
    const error = structuredError.safeParse(json);
    throw new ArioError({
      kind: 'http',
      message: error.success
        ? error.data.message
        : `Daemon request failed (HTTP ${response.status}).`,
      status: response.status,
    });
  }

  // Daemon success responses are bare JSON on read routes and empty on some write routes.
  if (expected === 'empty') {
    if (body === '') return;
  } else {
    const result = expected.safeParse(json);
    if (result.success) return result.data;
  }

  throw new ArioError({
    kind: 'invalid-response',
    message:
      'The address returned an unexpected response. Check that it points to the Ario daemon.',
  });
}
