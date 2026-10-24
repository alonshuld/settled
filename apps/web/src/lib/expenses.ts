import type { Expense } from '@/api/expenses';

export interface DayGroup<T> {
  date: string;
  items: T[];
}

/** Buckets an already date-sorted list into consecutive same-day groups (order is kept as received). */
export function groupByDay<T extends { date: string }>(items: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (last && last.date === item.date) last.items.push(item);
    else out.push({ date: item.date, items: [item] });
  }
  return out;
}

export type Effect =
  | { kind: 'lent'; amount: number }
  | { kind: 'borrowed'; amount: number }
  | { kind: 'none' };

/**
 * What an expense did to one member, in the group's base currency. The payer lent everything above their
 * own share; anyone else with a share borrowed it; the rest weren't involved.
 */
export function effectFor(e: Pick<Expense, 'paidByMemberId' | 'baseAmount' | 'shares'>, memberId: string | undefined): Effect {
  if (!memberId) return { kind: 'none' };
  const mine = e.shares.find((s) => s.memberId === memberId)?.amount ?? 0;
  if (e.paidByMemberId === memberId) {
    const lent = e.baseAmount - mine;
    return lent > 0 ? { kind: 'lent', amount: lent } : { kind: 'none' };
  }
  return mine > 0 ? { kind: 'borrowed', amount: mine } : { kind: 'none' };
}

/** 0–100 width of `value` against the largest magnitude; the biggest bar fills its half. */
export function barPercent(value: number, balances: { net: number }[]): number {
  const max = Math.max(0, ...balances.map((b) => Math.abs(b.net)));
  return max === 0 ? 0 : Math.round((Math.abs(value) / max) * 1000) / 10;
}

/** Share of the total as a 0–100 width, never collapsing a non-zero slice to nothing. */
export function sharePercent(amount: number, total: number): number {
  if (total <= 0 || amount <= 0) return 0;
  return Math.max(1, Math.round((amount / total) * 1000) / 10);
}
