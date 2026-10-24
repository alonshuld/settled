import { describe, expect, it } from 'vite-plus/test';
import { barPercent, effectFor, groupByDay, sharePercent } from './expenses';

const expense = (paidByMemberId: string, baseAmount: number, shares: Record<string, number>) => ({
  paidByMemberId,
  baseAmount,
  shares: Object.entries(shares).map(([memberId, amount]) => ({ memberId, amount, originalAmount: null, shares: null })),
});

describe('groupByDay', () => {
  it('groups consecutive same-day items and keeps order', () => {
    const items = [
      { id: 1, date: '2026-10-16' },
      { id: 2, date: '2026-10-13' },
      { id: 3, date: '2026-10-13' },
      { id: 4, date: '2026-10-12' },
    ];
    expect(groupByDay(items)).toEqual([
      { date: '2026-10-16', items: [items[0]] },
      { date: '2026-10-13', items: [items[1], items[2]] },
      { date: '2026-10-12', items: [items[3]] },
    ]);
  });

  it('handles an empty list', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('effectFor', () => {
  const hotel = expense('a', 480000, { a: 120000, n: 120000, i: 120000, m: 120000 });

  it('payer lent everything above their own share', () => {
    expect(effectFor(hotel, 'a')).toEqual({ kind: 'lent', amount: 360000 });
  });

  it('a sharer borrowed their share', () => {
    expect(effectFor(hotel, 'n')).toEqual({ kind: 'borrowed', amount: 120000 });
  });

  it('is none for someone outside the split', () => {
    expect(effectFor(expense('a', 1000, { a: 500, n: 500 }), 'm')).toEqual({ kind: 'none' });
  });

  it('is none when the payer covered only themselves', () => {
    expect(effectFor(expense('a', 1000, { a: 1000 }), 'a')).toEqual({ kind: 'none' });
  });

  it('is none without a member', () => {
    expect(effectFor(hotel, undefined)).toEqual({ kind: 'none' });
  });

  it('payer outside the split lent the whole amount', () => {
    expect(effectFor(expense('a', 1000, { n: 500, i: 500 }), 'a')).toEqual({ kind: 'lent', amount: 1000 });
  });
});

describe('percentages', () => {
  const nets = [{ net: 180000 }, { net: -90000 }, { net: -90000 }, { net: 0 }];

  it('scales bars to the largest balance', () => {
    expect(barPercent(180000, nets)).toBe(100);
    expect(barPercent(-90000, nets)).toBe(50);
    expect(barPercent(0, nets)).toBe(0);
  });

  it('is zero when everyone is square', () => {
    expect(barPercent(0, [{ net: 0 }])).toBe(0);
  });

  it('keeps tiny category slices visible', () => {
    expect(sharePercent(1, 100000)).toBe(1);
    expect(sharePercent(48, 100)).toBe(48);
    expect(sharePercent(0, 100)).toBe(0);
    expect(sharePercent(5, 0)).toBe(0);
  });
});
