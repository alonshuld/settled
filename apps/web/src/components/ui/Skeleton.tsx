import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/** Shimmer block; size it with utilities (`w-40 h-4`). Decorative: wrap the group in `aria-busy`. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" className={cn('skeleton block', className)} {...props} />;
}
