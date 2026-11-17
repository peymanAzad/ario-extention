import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { daemonAddressHint } from '@/shared/api/endpoint';
import { daemonKeys, useDaemonHealth } from '@/shared/api/queries';
import { checkDaemon, saveSettings } from '@/shared/browser/messages';
import { daemonOriginSchema } from '@/shared/types/settings';
import { Button } from '@/shared/ui/button';
import { ConnectionStatus } from '@/features/connection/connection-status';
import { DaemonDetails } from './daemon-details';

export function ConnectionSettings({
  origin,
  ready,
}: {
  origin: string;
  ready: boolean;
}) {
  const client = useQueryClient();
  const health = useDaemonHealth(origin, ready);
  const testRequest = useRef<AbortController | null>(null);
  const test = useMutation({
    mutationFn: ({
      address,
      signal,
    }: {
      address: string;
      signal: AbortSignal;
    }) => checkDaemon(address, signal),
  });
  useEffect(() => () => testRequest.current?.abort(), []);
  const {
    register,
    handleSubmit,
    setError,
    reset,
    clearErrors,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ defaultValues: { address: origin } });

  const addressField = register('address', {
    validate: (address) =>
      daemonOriginSchema.safeParse(address).success || daemonAddressHint,
    onChange: () => {
      testRequest.current?.abort();
      test.reset();
      clearErrors('root');
    },
  });

  function reconnect() {
    void client.invalidateQueries({ queryKey: daemonKeys.origin(origin) });
  }

  async function save({ address }: { address: string }) {
    try {
      const saved = await saveSettings({ connection: { origin: address } });
      if (saved.connection.origin === origin) {
        reset({ address: origin });
        reconnect();
      }
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Could not save the daemon address.',
      });
    }
  }

  function testConnection({ address }: { address: string }) {
    const controller = new AbortController();
    testRequest.current = controller;
    test.mutate({ address, signal: controller.signal });
  }

  return (
    <>
      <section
        aria-labelledby="connection-title"
        className="border-t border-border py-[19px]"
      >
        <h2 id="connection-title" className="mb-3 text-sm font-semibold">
          Daemon connection
        </h2>
        <form noValidate onSubmit={(event) => void handleSubmit(save)(event)}>
          <label htmlFor="daemon-address" className="mb-1.5 block text-xs">
            Server address
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              {...addressField}
              id="daemon-address"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={!ready || isSubmitting}
              aria-invalid={Boolean(errors.address)}
              aria-describedby={
                errors.address ? 'daemon-address-error' : undefined
              }
              className="h-9 min-w-[180px] flex-1 rounded-md border border-border bg-background px-2.5 text-xs disabled:opacity-60 max-[480px]:min-w-0 max-[480px]:basis-full"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!ready || isSubmitting || test.isPending}
              onClick={() => void handleSubmit(testConnection)()}
            >
              Test connection
            </Button>
            <Button type="submit" disabled={!ready || !isDirty || isSubmitting}>
              Save address
            </Button>
          </div>
          {errors.address && (
            <p
              id="daemon-address-error"
              role="alert"
              className="mt-2 text-xs text-destructive"
            >
              {errors.address.message}
            </p>
          )}
          {errors.root && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {errors.root.message}
            </p>
          )}
          {!test.isIdle && (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium">Connection test</p>
              <ConnectionStatus
                checking={test.isPending}
                health={test.data}
                error={test.error}
              />
            </div>
          )}
        </form>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="mb-1 text-xs font-medium">Saved connection</p>
            <ConnectionStatus
              checking={health.isFetching}
              health={health.data}
              error={health.error}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!ready || health.isFetching}
            onClick={reconnect}
          >
            Reconnect
          </Button>
        </div>
      </section>
      {health.isSuccess && (
        <DaemonDetails origin={origin} health={health.data} />
      )}
    </>
  );
}
