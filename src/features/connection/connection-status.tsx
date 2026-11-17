import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import type { DaemonHealth } from '@/shared/types/daemon';
import { ArioError } from '@/shared/types/connection';

export function ConnectionStatus({
  checking,
  health,
  error,
  compact = false,
}: {
  checking: boolean;
  health?: DaemonHealth;
  error?: Error | null;
  compact?: boolean;
}) {
  const connected = !checking && !error && health?.aria2_reachable === true;
  const failed = !checking && (error || health?.aria2_reachable === false);
  const status = checking
    ? 'Checking connection…'
    : error
      ? error instanceof ArioError && error.detail.kind === 'unavailable'
        ? 'Daemon unavailable'
        : 'Connection check failed'
      : health
        ? connected
          ? compact
            ? 'Daemon connected'
            : 'Connected · aria2 is ready'
          : 'Daemon connected · aria2 unreachable'
        : 'Waiting to check connection';
  const Icon = connected ? CircleCheck : failed ? CircleAlert : LoaderCircle;

  return (
    <div role="status" className="min-w-0 text-xs">
      <p
        className={`flex items-center gap-1.5 ${connected ? 'text-primary' : failed ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        <Icon
          size={14}
          aria-hidden="true"
          className={
            checking ? 'shrink-0 motion-safe:animate-spin' : 'shrink-0'
          }
        />
        {status}
      </p>
      {!compact && !checking && error && (
        <p className="mt-1 text-muted-foreground">{error.message}</p>
      )}
    </div>
  );
}
