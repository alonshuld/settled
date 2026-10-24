export interface BalanceExpense {
  id: string;
  paidByMemberId: string;
  baseAmount: number;
  deleted?: boolean;
}
export interface BalanceShare {
  expenseId: string;
  memberId: string;
  amount: number;
}
export interface BalanceSettlement {
  fromMemberId: string;
  toMemberId: string;
  baseAmount: number;
}
export interface MemberBalance {
  memberId: string;
  paid: number;
  share: number;
  sent: number;
  received: number;
  /** paid − share + sent − received. Positive = is owed money. */
  net: number;
}

/** `settlements` must already be filtered to confirmed ones. */
export function computeBalances(
  memberIds: string[],
  expenses: BalanceExpense[],
  shares: BalanceShare[],
  settlements: BalanceSettlement[],
): MemberBalance[] {
  const rows = new Map<string, MemberBalance>(
    memberIds.map((memberId) => [memberId, { memberId, paid: 0, share: 0, sent: 0, received: 0, net: 0 }]),
  );
  const live = new Set<string>();
  for (const e of expenses) {
    if (e.deleted) continue;
    live.add(e.id);
    const row = rows.get(e.paidByMemberId);
    if (row) row.paid += e.baseAmount;
  }
  for (const s of shares) {
    if (!live.has(s.expenseId)) continue;
    const row = rows.get(s.memberId);
    if (row) row.share += s.amount;
  }
  for (const s of settlements) {
    const from = rows.get(s.fromMemberId);
    const to = rows.get(s.toMemberId);
    if (from) from.sent += s.baseAmount;
    if (to) to.received += s.baseAmount;
  }
  for (const r of rows.values()) r.net = r.paid - r.share + r.sent - r.received;
  return [...rows.values()];
}
