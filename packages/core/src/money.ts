import { decimalsOf } from './currency.js';

/** Minor units → plain decimal string in major units ("340", "340.50", "1.234"). Always the currency's own decimals. */
export function toMajorString(amount: number, currency: string): string {
  const d = decimalsOf(currency);
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (d === 0) return `${sign}${abs}`;
  const s = String(abs).padStart(d + 1, '0');
  return `${sign}${s.slice(0, -d)}.${s.slice(-d)}`;
}

/** "₪340", "€40.50", "¥1,000": locale-aware, drops ".00" like the design does for whole amounts. */
export function formatMoney(amount: number, currency: string, locale: 'he' | 'en' = 'en'): string {
  const d = decimalsOf(currency);
  const major = amount / 10 ** d;
  return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(major) ? 0 : d,
    maximumFractionDigits: d,
  }).format(major);
}
