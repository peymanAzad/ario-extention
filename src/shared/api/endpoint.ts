export const loopbackHostPermissions = [
  'http://127.0.0.1/*',
  'http://localhost/*',
  'http://[::1]/*',
] as const;

export const defaultDaemonOrigin = 'http://127.0.0.1:47812';
export const daemonAddressHint =
  'Enter an HTTP address for 127.0.0.1, localhost, or [::1], with a port from 1 to 65535 if specified.';

export function parseDaemonOrigin(address: string): string | null {
  const value = address.trim();
  const match =
    /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?\/?$/i.exec(
      value,
    );
  if (!match) return null;

  const port = match[2];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
    return null;
  }
  return new URL(value).origin;
}
