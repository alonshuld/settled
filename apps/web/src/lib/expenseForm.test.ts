import { allocate } from '@settled/core';
import { describe, expect, it } from 'vite-plus/test';
import type { Expense } from '@/api/expenses';
import {
  buildCreateBody,
  buildUpdateBody,
  computeExpense,
  draftFromExpense,
  emptyDraft,
  parseAmount,
  type ExpenseDraft,
  type FormContext,
} from './expenseForm';

const ids = ['a', 'b', 'c'];
const ctx: FormContext = { groupCurrency: 'ILS', memberIds: ids, marketRate: null };
const draft = (over: Partial<ExpenseDraft> = {}): ExpenseDraft => ({
  ...emptyDraft({ currency: 'ILS', memberIds: ids, paidBy: 'a', date: '2026-10-17' }),
  amount: '100',
  description: 'Dinner',
  ...over,
});
const sum = (m: Map<string, number> | null) => [...(m?.values() ?? [])].reduce((x, y) => x + y, 0);

describe('parseAmount', () => {
  it('reads major units into minor units by currency decimals', () => {
    expect(parseAmount('12.5', 'ILS')).toEqual({ minor: 1250 });
    expect(parseAmount('12,5', 'ILS')).toEqual({ minor: 1250 });
    expect(parseAmount('1,250.75', 'ILS')).toEqual({ minor: 125075 });
    expect(parseAmount('1,250', 'ILS')).toEqual({ minor: 125000 });
    expect(parseAmount('1000', 'JPY')).toEqual({ minor: 1000 });
    expect(parseAmount('1.234', 'KWD')).toEqual({ minor: 1234 });
    expect(parseAmount('.5', 'ILS')).toEqual({ minor: 50 });
  });

  it('rejects empty, malformed, too precise and oversized input', () => {
    expect(parseAmount('', 'ILS')).toEqual({ error: 'empty' });
    expect(parseAmount('.', 'ILS')).toEqual({ error: 'invalid' });
    expect(parseAmount('1.2.3', 'ILS')).toEqual({ error: 'invalid' });
    expect(parseAmount('1.234', 'ILS')).toEqual({ error: 'decimals' });
    expect(parseAmount('1.5', 'JPY')).toEqual({ error: 'decimals' });
    expect(parseAmount('1000001', 'ILS')).toEqual({ error: 'tooLarge' });
  });
});

describe('computeExpense: equal split', () => {
  it('gives the leftover cent to the payer, like the server', () => {
    const c = computeExpense(draft({ amount: '100' }), ctx);
    expect(c.valid).toBe(true);
    expect([...c.shares!]).toEqual([
      ['a', 3334],
      ['b', 3333],
      ['c', 3333],
    ]);
    expect(sum(c.shares)).toBe(10000);
  });

  it('gives it to the first included member when the payer sits out', () => {
    const c = computeExpense(draft({ amount: '100', paidBy: 'a', included: ['b', 'c'] }), ctx);
    expect(c.shares!.get('a')).toBeUndefined();
    expect(sum(c.shares)).toBe(10000);
    const c2 = computeExpense(draft({ amount: '0.10', included: ['a', 'b', 'c'], paidBy: 'c' }), ctx);
    expect(c2.shares!.get('c')).toBe(4);
    expect(sum(c2.shares)).toBe(10);
  });

  it('needs at least one participant', () => {
    const c = computeExpense(draft({ included: [] }), ctx);
    expect(c.valid).toBe(false);
    expect(c.errors.split?.code).toBe('equalNone');
    expect(c.shares).toBeNull();
  });
});

describe('computeExpense: exact split', () => {
  it('accepts amounts that add up', () => {
    const c = computeExpense(draft({ mode: 'exact', amount: '100', exact: { a: '50', b: '30.5', c: '19.5' } }), ctx);
    expect(c.valid).toBe(true);
    expect(c.shares!.get('b')).toBe(3050);
    expect(c.exactSum).toBe(10000);
  });

  it('reports what is left or over', () => {
    const under = computeExpense(draft({ mode: 'exact', exact: { a: '50', b: '30', c: '' } }), ctx);
    expect(under.errors.split).toEqual({ code: 'exactUnder', params: { diff: 2000 } });
    const over = computeExpense(draft({ mode: 'exact', exact: { a: '60', b: '50', c: '' } }), ctx);
    expect(over.errors.split).toEqual({ code: 'exactOver', params: { diff: 1000 } });
    expect(over.valid).toBe(false);
  });

  it('needs an amount for someone and valid numbers', () => {
    expect(computeExpense(draft({ mode: 'exact', exact: { a: '', b: '', c: '' } }), ctx).errors.split?.code).toBe('exactNone');
    expect(computeExpense(draft({ mode: 'exact', exact: { a: 'x', b: '', c: '' } }), ctx).errors.split?.code).toBe('exactInvalid');
  });
});

describe('computeExpense: shares split', () => {
  it('splits by weight and distributes the remainder like core', () => {
    const c = computeExpense(draft({ mode: 'shares', amount: '100', shares: { a: 1, b: 1, c: 1 } }), ctx);
    expect(sum(c.shares)).toBe(10000);
    const d = computeExpense(draft({ mode: 'shares', amount: '10', shares: { a: 2, b: 1, c: 0 } }), ctx);
    expect([...d.shares!]).toEqual([
      ['a', 667],
      ['b', 333],
    ]);
    expect([...d.shares!.values()]).toEqual(allocate(1000, [2, 1]));
  });

  it('needs at least one share', () => {
    const c = computeExpense(draft({ mode: 'shares', shares: { a: 0, b: 0, c: 0 } }), ctx);
    expect(c.errors.split?.code).toBe('sharesNone');
  });
});

describe('computeExpense: validation and currency', () => {
  it('flags the empty form', () => {
    const c = computeExpense(draft({ amount: '', description: '  ' }), ctx);
    expect(c.valid).toBe(false);
    expect(c.errors.amount?.code).toBe('amountRequired');
    expect(c.errors.description?.code).toBe('descriptionRequired');
    expect(computeExpense(draft({ amount: '0' }), ctx).errors.amount?.code).toBe('amountZero');
  });

  it('converts a foreign amount at the market rate and splits the converted total', () => {
    const c = computeExpense(draft({ currency: 'USD', amount: '100' }), { ...ctx, marketRate: '3.7' });
    expect(c.baseMinor).toBe(37000);
    expect(sum(c.shares)).toBe(37000);
    expect(c.valid).toBe(true);
  });

  it('prefers a typed rate, and needs a valid one', () => {
    const typed = computeExpense(draft({ currency: 'USD', amount: '10', rate: '3.5' }), { ...ctx, marketRate: '3.7' });
    expect(typed.baseMinor).toBe(3500);
    expect(computeExpense(draft({ currency: 'USD', rate: '0' }), ctx).errors.rate?.code).toBe('rateInvalid');
    expect(computeExpense(draft({ currency: 'USD' }), ctx).errors.rate?.code).toBe('rateMissing');
  });

  it('keeps exact amounts in the expense currency and shares in the group currency', () => {
    const c = computeExpense(
      draft({ currency: 'USD', amount: '10', mode: 'exact', exact: { a: '4', b: '3', c: '3' } }),
      { ...ctx, marketRate: '3.7' },
    );
    expect(c.valid).toBe(true);
    expect([...c.shares!.values()]).toEqual([1480, 1110, 1110]);
  });
});

describe('payload building', () => {
  it('builds a create body in minor units', () => {
    const body = buildCreateBody(draft({ amount: '12.5', description: ' Taxi ', category: 'transport', receiptKey: 'receipts/g/x.jpg' }), ctx);
    expect(body).toEqual({
      amount: 1250,
      currency: 'ILS',
      description: 'Taxi',
      category: 'transport',
      paidByMemberId: 'a',
      date: '2026-10-17',
      receiptKey: 'receipts/g/x.jpg',
      split: { mode: 'equal', included: ['a', 'b', 'c'] },
    });
  });

  it('sends only non-zero exact amounts and shares, and a manual rate only when typed', () => {
    const exact = buildCreateBody(draft({ mode: 'exact', exact: { a: '60', b: '40', c: '' } }), ctx);
    expect(exact.split).toEqual({ mode: 'exact', amounts: { a: 6000, b: 4000 } });
    const shares = buildCreateBody(draft({ mode: 'shares', shares: { a: 2, b: 0, c: 1 } }), ctx);
    expect(shares.split).toEqual({ mode: 'shares', shares: { a: 2, c: 1 } });
    expect(buildCreateBody(draft({ currency: 'USD' }), { ...ctx, marketRate: '3.7' })).not.toHaveProperty('fxRate');
    expect(buildCreateBody(draft({ currency: 'USD', rate: '3.5' }), ctx).fxRate).toBe('3.5');
    expect(buildCreateBody(draft({ rate: '3.5' }), ctx)).not.toHaveProperty('fxRate');
  });
});

describe('editing', () => {
  const original: Expense = {
    id: 'e1',
    groupId: 'g',
    description: 'Dinner',
    category: 'food',
    amount: 10000,
    currency: 'ILS',
    fxRate: '1',
    fxSource: 'same',
    fxDate: null,
    baseAmount: 10000,
    paidByMemberId: 'a',
    date: '2026-10-17',
    hasReceipt: false,
    receiptKey: null,
    splitMode: 'exact',
    shares: [
      { memberId: 'a', amount: 6000, originalAmount: 6000, shares: null },
      { memberId: 'b', amount: 4000, originalAmount: 4000, shares: null },
    ],
    createdByMemberId: 'a',
    version: 3,
    createdAt: '',
    updatedAt: '',
  };

  it('restores the draft from the stored expense', () => {
    const d = draftFromExpense(original, ids);
    expect(d.amount).toBe('100.00');
    expect(d.mode).toBe('exact');
    expect(d.exact).toEqual({ a: '60.00', b: '40.00', c: '' });
    expect(d.rate).toBeNull();
    expect(computeExpense(d, ctx).valid).toBe(true);
  });

  it('sends the version, the split and only the changed fields', () => {
    const d = { ...draftFromExpense(original, ids), description: 'Dinner out' };
    expect(buildUpdateBody(d, original, ctx)).toEqual({
      version: 3,
      description: 'Dinner out',
      split: { mode: 'exact', amounts: { a: 6000, b: 4000 } },
    });
  });

  it('leaves the stored rate alone unless the user changes it', () => {
    const usd: Expense = { ...original, currency: 'USD', fxRate: '3.7', fxSource: 'market', baseAmount: 37000 };
    const d = draftFromExpense(usd, ids);
    expect(buildUpdateBody(d, usd, ctx)).not.toHaveProperty('fxRate');
    expect(buildUpdateBody({ ...d, rate: '3.6' }, usd, ctx).fxRate).toBe('3.6');

    const manual: Expense = { ...usd, fxRate: '3.6', fxSource: 'manual' };
    const m = draftFromExpense(manual, ids);
    expect(m.rate).toBe('3.6');
    expect(buildUpdateBody(m, manual, ctx)).not.toHaveProperty('fxRate');
    expect(buildUpdateBody({ ...m, rate: null }, manual, ctx).fxRate).toBeNull();
  });
});
