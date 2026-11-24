import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Music2, Video } from 'lucide-react';
import { getDetectedMedia, openDetectedMedia } from '@/shared/browser/messages';
import { mediaFileName } from '@/shared/types/media';
import { Button } from '@/shared/ui/button';
import { AppHeader } from '@/shared/ui/shell';

export function MediaView({
  enabled,
  onBack,
}: {
  enabled: boolean;
  onBack: () => void;
}) {
  const detected = useQuery({
    queryKey: ['detectedMedia'],
    queryFn: getDetectedMedia,
    enabled,
    refetchInterval: 1000,
    retry: false,
  });
  const open = useMutation({ mutationFn: openDetectedMedia });

  return (
    <div className="min-h-[580px] bg-background">
      <AppHeader />
      <main className="px-5 py-4">
        <div className="mb-4 flex items-center gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            Downloads
          </Button>
          <h1>Media</h1>
        </div>
        {open.isError && (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {open.error.message}
          </p>
        )}
        {!enabled ? (
          <p className="text-xs text-muted-foreground">
            Media detection is off. Turn on Detect media in Settings.
          </p>
        ) : detected.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {detected.error.message}
          </p>
        ) : detected.isPending ? (
          <p role="status" className="text-xs text-muted-foreground">
            Checking this tab…
          </p>
        ) : detected.data.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Play a video or audio file on this tab to look for supported
            downloads.
          </p>
        ) : (
          <ul
            aria-label="Media on this tab"
            className="divide-y divide-border rounded-md border border-border"
          >
            {detected.data.map(({ id, url, kind }) => {
              const source = new URL(url);
              const name = mediaFileName(source);
              const Icon = kind === 'video' ? Video : Music2;
              return (
                <li key={id} className="flex items-center gap-3 px-3 py-2">
                  <Icon
                    size={16}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={name}>
                      <bdi>{name}</bdi>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      <bdi>{source.host}</bdi>
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Download ${name}`}
                    disabled={open.isPending}
                    onClick={() => open.mutate(id)}
                  >
                    Download
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
