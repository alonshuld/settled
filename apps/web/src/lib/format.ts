import { decimalsOf } from '@settled/core';

export type Lang = 'he' | 'en';

// Bidi isolates keep "+₪1,580" visually intact when the surrounding text is RTL.
const LRI = '⁦';
const PDI = '⁩';

export const isolate = (s: string) => `${LRI}${s}${PDI}`;

const decimals = (currency: string) => {
  try {
    return decimalsOf(currency);
  } catch {
    return 2;
  }
};

export interface MoneyOptions {
  /** Always show + or - (hero balances). */
  signed?: boolean;
}

/**
 * Integer minor units -> "₪1,800" / "€40.50" in both languages (design shows the same Latin grouping and
 * leading symbol in Hebrew), LTR-isolated. Whole amounts drop the zero decimals.
 */
export function formatMoney(minor: number, currency: string, _lang: Lang = 'en', opts: MoneyOptions = {}): string {
  const d = decimals(currency);
  const major = minor / 10 ** d;
  const whole = Number.isInteger(major);
  let out: string;
  try {
    out = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: whole ? 0 : d,
      maximumFractionDigits: d,
      signDisplay: opts.signed ? 'exceptZero' : 'auto',
    }).format(major);
  } catch {
    out = `${major} ${currency}`;
  }
  return isolate(out);
}

const locale = (lang: Lang) => (lang === 'he' ? 'he-IL' : 'en-US');

/** Parses a `YYYY-MM-DD` API date as a calendar day (no timezone shift). */
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function formatDate(
  value: string | Date,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
): string {
  const isDay = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = isDay ? day(value) : new Date(value);
  return new Intl.DateTimeFormat(locale(lang), { ...opts, ...(isDay ? { timeZone: 'UTC' } : {}) }).format(date);
}

/** "12–18 Oct" / "12–18 באוק׳"; either end may be missing. */
export function formatDateRange(start: string | null | undefined, end: string | null | undefined, lang: Lang): string {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  if (start && end && start !== end) return new Intl.DateTimeFormat(locale(lang), opts).formatRange(day(start), day(end));
  const one = start ?? end;
  return one ? formatDate(one, lang, { day: 'numeric', month: 'short' }) : '';
}
