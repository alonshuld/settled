import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-95',
  ghost: 'bg-surface text-ink border border-line hover:bg-surface2',
  danger: 'bg-transparent text-neg border border-neg',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control px-4.5 text-[15px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex size-11 cursor-pointer items-center justify-center rounded-control border border-line bg-surface text-[13px] font-semibold text-ink hover:bg-surface2',
        className,
      )}
      {...props}
    />
  );
}
