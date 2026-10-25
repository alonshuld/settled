import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Segmented choice (theme, language). Buttons with aria-pressed: simple and keyboard friendly. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; lang?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-control border border-line bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          lang={o.lang}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[9px] px-3 text-sm font-medium',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  busy,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // 44px tall hit area around a 28px track
        'relative inline-flex h-11 w-14 flex-none cursor-pointer items-center disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <span className={cn('absolute inset-x-0 top-2 h-7 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line')} />
      <span
        className={cn(
          'absolute top-2.5 size-6 rounded-full bg-white shadow transition-[inset-inline-start]',
          checked ? 'start-[calc(100%-1.625rem)]' : 'start-0.5',
        )}
      />
    </button>
  );
}

export const sectionCard = 'scroll-mt-24 rounded-card border border-line bg-surface p-5 md:p-7';
