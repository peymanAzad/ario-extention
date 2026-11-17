import { Brand } from '@/shared/ui/shell';

export function Confirmation() {
  return (
    <main className="mx-auto max-w-[440px] p-4 sm:pt-8">
      <div className="rounded-lg border border-border bg-card p-6 text-card-foreground">
        <Brand />
        <h1 className="mt-5">Download with Ario</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Download confirmation will be available when browser handoff is added.
        </p>
      </div>
    </main>
  );
}
