export interface Transfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
}

/**
 * Greedy min-cash-flow: repeatedly match the largest debtor with the largest creditor.
 * Ties break by input order so results are stable between requests.
 */
export function simplifyDebts(nets: { memberId: string; net: number }[]): Transfer[] {
  const debtors = nets.filter((n) => n.net < 0).map((n) => ({ id: n.memberId, left: -n.net }));
  const creditors = nets.filter((n) => n.net > 0).map((n) => ({ id: n.memberId, left: n.net }));
  const largest = (xs: { left: number }[]) => {
    let best = -1;
    xs.forEach((x, i) => {
      if (x.left > 0 && (best === -1 || x.left > xs[best]!.left)) best = i;
    });
    return best;
  };
  const out: Transfer[] = [];
  for (;;) {
    const d = largest(debtors);
    const c = largest(creditors);
    if (d === -1 || c === -1) break;
    const amount = Math.min(debtors[d]!.left, creditors[c]!.left);
    out.push({ fromMemberId: debtors[d]!.id, toMemberId: creditors[c]!.id, amount });
    debtors[d]!.left -= amount;
    creditors[c]!.left -= amount;
  }
  return out;
}
