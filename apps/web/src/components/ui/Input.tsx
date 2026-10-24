import type { InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const inputClass =
  'min-h-13 w-full rounded-control border border-line bg-surface2 px-3.5 text-base text-ink placeholder:text-muted focus:outline-2 focus:outline-offset-1 focus:outline-accent aria-invalid:border-neg';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}
