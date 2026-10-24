export interface DiffableExpense {
  description: string;
  category: string;
  amount: number;
  currency: string;
  fxRate: string;
  baseAmount: number;
  paidByMemberId: string;
  /** YYYY-MM-DD */
  date: string;
  splitMode: string;
  receiptKey: string | null;
  /** Final shares in base currency, by member. */
  shares: { memberId: string; amount: number }[];
}

export interface ExpenseDiff {
  /** Changed top-level fields as `[before, after]`. Member ids stay ids; callers map them to names. */
  fields: Record<string, [unknown, unknown]>;
  /** Members whose effect on their balance changed: (paid − share) before vs after. */
  netChanges: { memberId: string; before: number; after: number }[];
}

const FIELDS = [
  'description',
  'category',
  'amount',
  'currency',
  'fxRate',
  'baseAmount',
  'paidByMemberId',
  'date',
  'splitMode',
  'receiptKey',
] as const;

/** How much the expense moves each member's net: paid − share. `null` = the expense does not exist. */
function effects(e: DiffableExpense | null): Map<string, number> {
  const out = new Map<string, number>();
  if (!e) return out;
  out.set(e.paidByMemberId, e.baseAmount);
  for (const s of e.shares) out.set(s.memberId, (out.get(s.memberId) ?? 0) - s.amount);
  return out;
}

/** Field-level diff plus each member's balance change. Pass `null` for `after` on delete. */
export function expenseDiff(before: DiffableExpense, after: DiffableExpense | null): ExpenseDiff {
  const fields: ExpenseDiff['fields'] = {};
  if (after) {
    for (const f of FIELDS) if (before[f] !== after[f]) fields[f] = [before[f], after[f]];
    const sharesOf = (e: DiffableExpense) =>
      JSON.stringify([...e.shares].sort((a, b) => a.memberId.localeCompare(b.memberId)).map((s) => [s.memberId, s.amount]));
    if (sharesOf(before) !== sharesOf(after)) {
      fields.shares = [before.shares, after.shares];
    }
  }
  const was = effects(before);
  const now = effects(after);
  const netChanges = [...new Set([...was.keys(), ...now.keys()])]
    .map((memberId) => ({ memberId, before: was.get(memberId) ?? 0, after: now.get(memberId) ?? 0 }))
    .filter((c) => c.before !== c.after);
  return { fields, netChanges };
}
