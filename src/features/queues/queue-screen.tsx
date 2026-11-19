import { ArrowLeft, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/button';

export function QueueScreen({
  children,
  backLabel,
  onBack,
  onClose,
  busy,
}: {
  children: ReactNode;
  backLabel: string;
  onBack: () => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="queue-header">
        <div className="flex items-center gap-2 font-medium">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={backLabel}
            onClick={onBack}
            disabled={busy}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          Queues
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close queues"
          onClick={onClose}
          disabled={busy}
        >
          <X aria-hidden="true" />
        </Button>
      </header>
      {children}
    </div>
  );
}
