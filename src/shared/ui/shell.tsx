import { ArrowDownToLine } from 'lucide-react';
import type { ReactNode } from 'react';

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-[31px] place-items-center rounded-[9px] bg-primary-muted text-primary">
        <ArrowDownToLine size={20} aria-hidden="true" />
      </span>
      <span className="text-[21px] font-[650] tracking-[-0.05em]">ario</span>
    </div>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-[66px] shrink-0 items-center justify-between gap-2.5 border-b border-border px-5 max-[580px]:px-3">
      <Brand />
      {children}
    </header>
  );
}
