export type SplitMode = 'equal' | 'exact' | 'shares';

export interface SplitInput {
  /** Original amount, expense currency minor units. */
  amount: number;
  /** Converted amount, group base currency. Returned shares sum to this exactly. */
  baseAmount: number;
  payerId: string;
  members: { id: string; order: number }[];
  mode: SplitMode;
  included?: string[];
  exact?: Record<string, number>;
  shares?: Record<string, number>;
}

export interface ComputedShare {
  memberId: string;
  amount: number;
  originalAmount?: number;
  shares?: number;
}

export class SplitError extends Error {
  constructor(
    public readonly code: 'SPLIT_SUM_MISMATCH' | 'VALIDATION_FAILED',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Splits `total` proportionally to `weights` using the largest-remainder method.
 * Leftover units go to the largest fractional remainders; ties go to earlier entries,
 * so callers put the preferred recipient (the payer) first.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new SplitError('VALIDATION_FAILED', 'Weights must have a positive sum');
  const t = BigInt(total);
  const s = BigInt(sum);
  const floors = weights.map((w) => (t * BigInt(w)) / s);
  const rems = weights.map((w) => (t * BigInt(w)) % s);
  let left = Number(t - floors.reduce((a, b) => a + b, 0n));
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (rems[a]! === rems[b]! ? a - b : rems[a]! > rems[b]! ? -1 : 1));
  const out = floors.map(Number);
  for (const i of order) {
    if (left === 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

export function computeShares(input: SplitInput): ComputedShare[] {
  const { amount, baseAmount, payerId, mode } = input;
  const byOrder = [...input.members].sort((a, b) => a.order - b.order);
  const known = new Set(byOrder.map((m) => m.id));

  let participants: string[];
  let weights: number[];

  if (mode === 'equal') {
    const inc = new Set(input.included ?? byOrder.map((m) => m.id));
    participants = byOrder.map((m) => m.id).filter((id) => inc.has(id));
    if (participants.length === 0) throw new SplitError('VALIDATION_FAILED', 'Nobody included in split');
    // payer first so they take the leftover units
    if (participants.includes(payerId)) participants = [payerId, ...participants.filter((id) => id !== payerId)];
    weights = participants.map(() => 1);
  } else if (mode === 'exact') {
    const exact = input.exact ?? {};
    participants = byOrder.map((m) => m.id).filter((id) => (exact[id] ?? 0) > 0);
    const actual = participants.reduce((a, id) => a + exact[id]!, 0);
    if (actual !== amount) {
      throw new SplitError('SPLIT_SUM_MISMATCH', 'Exact amounts must add up to the total.', {
        expected: amount,
        actual,
      });
    }
    weights = participants.map((id) => exact[id]!);
  } else {
    const sh = input.shares ?? {};
    participants = byOrder.map((m) => m.id).filter((id) => (sh[id] ?? 0) > 0);
    if (participants.length === 0) throw new SplitError('VALIDATION_FAILED', 'Shares must have a positive sum');
    weights = participants.map((id) => sh[id]!);
  }

  for (const id of participants) {
    if (!known.has(id)) throw new SplitError('VALIDATION_FAILED', `Unknown member: ${id}`, { memberId: id });
  }

  const amounts = allocate(baseAmount, weights);
  const result = participants.map((memberId, i): ComputedShare => {
    const share: ComputedShare = { memberId, amount: amounts[i]! };
    if (mode === 'exact') share.originalAmount = input.exact![memberId]!;
    if (mode === 'shares') share.shares = input.shares![memberId]!;
    return share;
  });
  return result;
}
