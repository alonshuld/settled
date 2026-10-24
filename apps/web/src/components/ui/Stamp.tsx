import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

/** The brand "settled" stamp (word + check in a rounded outline), tilted like a rubber stamp. */
export function Stamp({
  children,
  className,
  iconSize = 36,
  style,
}: {
  children: string;
  className?: string;
  iconSize?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn('flex -rotate-[8deg] items-center gap-2.5 rounded-[18px] border-4 font-extrabold', className)}
    >
      {children}
      <Check size={iconSize} strokeWidth={3} aria-hidden="true" />
    </div>
  );
}
