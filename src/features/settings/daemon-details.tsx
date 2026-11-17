import { useDaemonSettings } from '@/shared/api/queries';
import type { DaemonHealth, DaemonSettings } from '@/shared/types/daemon';

function proxyStatus(
  proxy: DaemonSettings['proxy'],
  health: DaemonHealth,
): string {
  if (!proxy.enabled) return 'Disabled';
  if (health.proxy_reachable === false) return 'Unreachable';
  if (health.proxy_data === false) return 'Reachable · data check failed';
  if (health.proxy_data === true) return 'Reachable · data check passed';
  if (health.proxy_reachable === true) return 'Reachable';
  return 'Status unavailable';
}

export function DaemonDetails({
  origin,
  health,
}: {
  origin: string;
  health: DaemonHealth;
}) {
  const settings = useDaemonSettings(origin);
  const daemon = settings.data;
  const globalOptions = health.aria2_global_options;
  const aria2Defaults = [
    ['Connections per download', globalOptions?.connections_per_download],
    ['Connections per server', globalOptions?.max_connections_per_server],
    ['File allocation', globalOptions?.alloc_strategy],
    ['Piece selection', globalOptions?.stream_piece_selector],
  ] as const;

  return (
    <section
      aria-labelledby="daemon-settings-title"
      className="border-t border-border py-[19px]"
    >
      <h2 id="daemon-settings-title" className="mb-3 text-sm font-semibold">
        Daemon settings
      </h2>
      {settings.isPending && (
        <p role="status" className="text-xs text-muted-foreground">
          Reading daemon settings…
        </p>
      )}
      {settings.isError && (
        <p role="alert" className="text-xs text-destructive">
          {settings.error.message}
        </p>
      )}
      {settings.isSuccess && daemon && (
        <div className="grid gap-4 text-xs sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <h3 className="mb-2 font-medium">Download locations</h3>
            <dl className="grid gap-2">
              <div>
                <dt className="text-muted-foreground">Default</dt>
                <dd className="font-mono break-all">
                  {daemon.default_download_location}
                </dd>
              </div>
              {Object.entries(daemon.category_locations)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([category, path]) => (
                  <div key={category}>
                    <dt className="text-muted-foreground">{category}</dt>
                    <dd className="font-mono break-all">{path}</dd>
                  </div>
                ))}
            </dl>
          </div>
          <div>
            <h3 className="mb-2 font-medium">Proxy</h3>
            <p>{proxyStatus(daemon.proxy, health)}</p>
            {daemon.proxy.host && (
              <dl className="mt-2 grid gap-2">
                <div>
                  <dt className="text-muted-foreground">Host</dt>
                  <dd className="font-mono break-all">{daemon.proxy.host}</dd>
                </div>
                {daemon.proxy.port !== null && (
                  <div>
                    <dt className="text-muted-foreground">Port</dt>
                    <dd className="font-mono">{daemon.proxy.port}</dd>
                  </div>
                )}
              </dl>
            )}
            {aria2Defaults.some(([, value]) => value != null) && (
              <>
                <h3 className="mt-4 mb-2 font-medium">aria2 defaults</h3>
                <dl className="grid gap-2">
                  {aria2Defaults.map(
                    ([label, value]) =>
                      value != null && (
                        <div key={label}>
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd>{value}</dd>
                        </div>
                      ),
                  )}
                </dl>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
