import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export const OTP_LENGTH = 6;

/**
 * Six single-digit boxes. `value` is a contiguous digit string (no gaps): typing fills the next box,
 * backspace removes, pasting (or an SMS/email autofill that drops the whole code in one box) spreads digits.
 * Always an LTR island so digits read left-to-right in Hebrew too.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  autoFocus,
  length = OTP_LENGTH,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  error?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
}) {
  const { t } = useTranslation();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Focus we move ourselves happens before the new `value` has rendered, so it must skip the onFocus clamp.
  const moving = useRef(false);
  const focus = (i: number) => {
    moving.current = true;
    refs.current[Math.max(0, Math.min(i, length - 1))]?.focus();
    moving.current = false;
  };

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  // After an error the parent clears the value: put the caret back on the first box.
  useEffect(() => {
    if (value === '' && error) refs.current[0]?.focus();
  }, [value, error]);

  function commit(next: string, caret: number) {
    const clean = next.slice(0, length);
    onChange(clean);
    // Editing a full code digit by digit must not fire a submit per keystroke.
    if (clean.length === length && value.length < length) onComplete?.(clean);
    focus(caret);
  }

  function insert(at: number, raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return;
    // A single digit overwrites the box; several (paste/autofill) are spread from that box on.
    const head = value.slice(0, Math.min(at, value.length));
    const tail = digits.length === 1 ? value.slice(at + 1) : '';
    const next = (head + digits + tail).slice(0, length);
    commit(next, Math.min(head.length + digits.length, length - 1));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (i < value.length) commit(value.slice(0, i) + value.slice(i + 1), i);
      else if (i > 0) commit(value.slice(0, i - 1), i - 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, i: number) {
    e.preventDefault();
    insert(i, e.clipboardData.getData('text'));
  }

  return (
    <div dir="ltr" role="group" aria-label={t('login.otpGroup')} className="flex justify-between gap-2">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={value[i] ?? ''}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={t('login.digit', { n: i + 1 })}
          aria-invalid={error || undefined}
          disabled={disabled}
          // Boxes past the end of the code are not reachable by click: the caret goes to the first empty one.
          onFocus={(e) => {
            if (moving.current) return;
            if (i > value.length) focus(value.length);
            else e.currentTarget.select();
          }}
          onChange={(e) => insert(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
          onPaste={(e) => onPaste(e, i)}
          className={cn(
            'h-16 w-full max-w-14 min-w-0 flex-1 rounded-[14px] border-[1.5px] text-center text-[26px] font-semibold text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent disabled:opacity-60',
            error ? 'border-neg bg-neg-bg' : 'border-line bg-surface2',
          )}
        />
      ))}
    </div>
  );
}
