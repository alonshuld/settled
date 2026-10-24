import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'ghost' | 'danger' | 'text';

type Size = 'md' | 'lg';

// No Tailwind class merging here: variants/sizes own their padding and height, so callers never override them.
const variants: Record<Variant, string> = {
  primary: 'bg-accent px-4.5 font-semibold text-accent-ink hover:brightness-95',
  ghost: 'border border-line bg-surface px-4.5 font-semibold text-ink hover:bg-surface2',
  danger: 'border border-neg bg-transparent px-4.5 font-semibold text-neg',
  text: 'bg-transparent px-1.5 hover:bg-surface2',
};
const sizes: Record<Size, string> = {
  md: 'min-h-11 text-[15px]',
  lg: 'min-h-13.5 w-full text-base',
};

/** Class string for non-button elements (e.g. a router `<Link>` that should look like a button). */
export function buttonClass(variant: Variant = 'primary', className?: string, size: Size = 'md') {
  return cn(
    'inline-flex cursor-pointer items-center justify-center gap-2 rounded-control whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 aria-busy:cursor-progress',
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  loading,
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      className={buttonClass(variant, className, size)}
      // Repeat clicks are ignored while busy; the button stays focusable (not `disabled`) so focus isn't lost.
      onClick={loading ? undefined : onClick}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
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
