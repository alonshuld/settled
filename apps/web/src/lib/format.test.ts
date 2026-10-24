import { describe, expect, it } from 'vite-plus/test';
import { formatDate, formatDateRange, formatMoney, isolate } from './format';

const strip = (s: string) => s.replace(/[\u2066\u2069]/g, '').replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('formats minor units with the leading symbol in both languages', () => {
    expect(strip(formatMoney(180000, 'ILS', 'he'))).toBe('₪1,800');
    expect(strip(formatMoney(180000, 'ILS', 'en'))).toBe('₪1,800');
    expect(strip(formatMoney(4050, 'EUR', 'en'))).toBe('€40.50');
    expect(strip(formatMoney(1234500, 'USD'))).toBe('$12,345');
  });

  it('honours currency decimals', () => {
    expect(strip(formatMoney(1000, 'JPY'))).toBe('¥1,000');
    expect(strip(formatMoney(1500, 'KWD'))).toBe('KWD 1.500');
  });

  it('wraps the result in an LTR isolate', () => {
    expect(formatMoney(100, 'ILS')).toBe(isolate('₪1'));
  });

  it('shows explicit signs when asked and never for zero', () => {
    expect(strip(formatMoney(158000, 'ILS', 'en', { signed: true }))).toBe('+₪1,580');
    expect(strip(formatMoney(-34000, 'ILS', 'en', { signed: true }))).toBe('-₪340');
    expect(strip(formatMoney(0, 'ILS', 'en', { signed: true }))).toBe('₪0');
  });

  it('keeps cents when the amount is not whole', () => {
    expect(strip(formatMoney(34050, 'ILS'))).toBe('₪340.50');
  });

  it('survives an unknown currency code', () => {
    expect(() => formatMoney(500, 'XXX9')).not.toThrow();
  });
});

describe('formatDate', () => {
  it('does not shift calendar days across timezones', () => {
    expect(formatDate('2026-10-24', 'en', { day: 'numeric', month: 'long' })).toBe('October 24');
  });

  it('formats Hebrew', () => {
    expect(formatDate('2026-10-24', 'he', { day: 'numeric', month: 'long' })).toBe('24 באוקטובר');
  });
});

describe('formatDateRange', () => {
  it('collapses a range', () => {
    expect(formatDateRange('2026-10-12', '2026-10-18', 'en')).toMatch(/^Oct 12\s?[–-]\s?18$/);
  });
  it('handles a single or missing end', () => {
    expect(formatDateRange('2026-10-12', null, 'en')).toBe('Oct 12');
    expect(formatDateRange(null, null, 'en')).toBe('');
    expect(formatDateRange('2026-10-12', '2026-10-12', 'en')).toBe('Oct 12');
  });
});
