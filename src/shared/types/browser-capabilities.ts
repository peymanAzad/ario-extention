import { z } from 'zod';

export const browserHandoffProtocolVersion = 1;

export const browserCapabilitiesSchema = z.object({
  protocol_version: z.int().positive(),
  staged_handoff: z.boolean(),
  http_session: z.boolean(),
  daemon_timezone: z.string().trim().min(1).nullable(),
});

export type BrowserCapabilities = z.infer<typeof browserCapabilitiesSchema>;

export function supportsBrowserHandoff(
  capabilities: BrowserCapabilities | null | undefined,
): boolean {
  return (
    capabilities?.protocol_version === browserHandoffProtocolVersion &&
    capabilities.staged_handoff
  );
}
