import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';
import { Button } from '@/shared/ui/button';

export function WorkflowDialog({
  title,
  description,
  children,
  busy = false,
  onClose,
}: {
  title: string;
  description: string;
  children: ReactNode;
  busy?: boolean;
  onClose: () => void;
}) {
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="workflow-overlay" />
        <Dialog.Content
          className="workflow-dialog"
          onOpenAutoFocus={() => {
            opener.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (
              opener.current?.isConnected &&
              !opener.current.matches(':disabled')
            ) {
              opener.current.focus();
            } else {
              document.getElementById('add-download')?.focus();
            }
          }}
        >
          <div className="mb-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Dialog.Title className="text-base font-semibold tracking-tight">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-[11px] break-words text-muted-foreground">
                {description}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close dialog"
                disabled={busy}
              >
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
