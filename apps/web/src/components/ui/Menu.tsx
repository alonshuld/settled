import * as DM from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const item =
  'flex min-h-11 cursor-pointer select-none items-center gap-2.5 rounded-[10px] px-3 text-[15px] font-medium outline-none data-[highlighted]:bg-surface2';

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align="end"
        sideOffset={8}
        className={cn('z-50 min-w-52 rounded-card border border-line bg-surface p-1.5 shadow-[0_8px_24px_rgba(0,0,0,.16)]', className)}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ children, onSelect, className, asChild }: { children: ReactNode; onSelect?: () => void; className?: string; asChild?: boolean }) {
  return (
    <DM.Item asChild={asChild} onSelect={onSelect} className={cn(item, className)}>
      {children}
    </DM.Item>
  );
}

export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DM.Label className="truncate px-3 py-2 text-sm text-muted">{children}</DM.Label>
);

export const MenuSeparator = () => <DM.Separator className="my-1 h-px bg-line" />;
