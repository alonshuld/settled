import { describe, expect, it } from 'vite-plus/test';
import {
  appendPaymentDetails,
  buildPayOptions,
  computeBalances,
  computeShares,
  convert,
  crossRate,
  decimalsOf,
  expenseDiff,
  formatInviteCode,
  generateInviteCode,
  isCurrency,
  parseInviteCode,
  renderReminder,
  smsLink,
  toMajorString,
  whatsappLink,
  simplifyDebts,
  SplitError,
} from '../src/index.js';

const members = ['alon', 'noa', 'itay', 'maya'].map((id, order) => ({ id, order }));

describe('currency', () => {
  it('knows decimals', () => {
    expect(decimalsOf('ILS')).toBe(2);
    expect(decimalsOf('JPY')).toBe(0);
    expect(decimalsOf('KWD')).toBe(3);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('XXX')).toBe(false);
  });

  it('converts EUR→ILS', () => {
    expect(convert(4000, 'EUR', 'ILS', '3.9821')).toBe(15928);
  });

  it('handles 0 and 3 decimal currencies', () => {
    // ¥1000 at 0.0245 ILS/JPY = ₪24.50
    expect(convert(1000, 'JPY', 'ILS', '0.0245')).toBe(2450);
    // 1.000 KWD at 12 ILS = ₪12.00
    expect(convert(1000, 'KWD', 'ILS', '12')).toBe(1200);
    // ₪10.00 at 0.5 KWD/ILS = 5.000 KWD
    expect(convert(1000, 'ILS', 'KWD', '0.5')).toBe(5000);
    // ₪100.00 → JPY at 40.5 = ¥4050
    expect(convert(10000, 'ILS', 'JPY', '40.5')).toBe(4050);
  });

  it('rounds half to even', () => {
    expect(convert(25, 'USD', 'USD', '0.1')).toBe(2); // 2.5 → 2
    expect(convert(35, 'USD', 'USD', '0.1')).toBe(4); // 3.5 → 4
  });

  it('computes cross rates', () => {
    expect(crossRate('1', '3.5')).toBe('3.5');
    expect(crossRate('0.5', '2')).toBe('4');
  });
});

describe('split', () => {
  it('splits a converted €40 expense 3 ways with the extra agora to the payer', () => {
    const baseAmount = convert(4000, 'EUR', 'ILS', '3.9821');
    expect(baseAmount).toBe(15928);
    const shares = computeShares({
      amount: 4000,
      baseAmount,
      payerId: 'noa',
      members: members.slice(0, 3),
      mode: 'equal',
    });
    const byId = Object.fromEntries(shares.map((s) => [s.memberId, s.amount]));
    expect(byId).toEqual({ alon: 5309, noa: 5310, itay: 5309 });
    expect(shares.reduce((a, s) => a + s.amount, 0)).toBe(15928);
  });

  it('gives remainder to first included member when payer is excluded', () => {
    const shares = computeShares({
      amount: 100,
      baseAmount: 100,
      payerId: 'alon',
      members,
      mode: 'equal',
      included: ['noa', 'itay', 'maya'],
    });
    expect(shares.map((s) => [s.memberId, s.amount])).toEqual([
      ['noa', 34],
      ['itay', 33],
      ['maya', 33],
    ]);
  });

  it('splits JPY and KWD without losing units', () => {
    const jpy = computeShares({ amount: 1000, baseAmount: 1000, payerId: 'alon', members: members.slice(0, 3), mode: 'equal' });
    expect(jpy.reduce((a, s) => a + s.amount, 0)).toBe(1000);
    const kwd = computeShares({ amount: 1001, baseAmount: 1001, payerId: 'alon', members: members.slice(0, 3), mode: 'equal' });
    expect(kwd.reduce((a, s) => a + s.amount, 0)).toBe(1001);
    expect(kwd[0]).toMatchObject({ memberId: 'alon', amount: 334 });
  });

  it('exact mode converts proportionally and sums to base', () => {
    const shares = computeShares({
      amount: 4000,
      baseAmount: 15928,
      payerId: 'alon',
      members,
      mode: 'exact',
      exact: { alon: 1000, noa: 1000, itay: 2000 },
    });
    expect(shares.reduce((a, s) => a + s.amount, 0)).toBe(15928);
    expect(shares.find((s) => s.memberId === 'itay')).toMatchObject({ amount: 7964, originalAmount: 2000 });
  });

  it('exact mode rejects mismatched sums', () => {
    try {
      computeShares({ amount: 100, baseAmount: 100, payerId: 'alon', members, mode: 'exact', exact: { alon: 40, noa: 50 } });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(SplitError);
      expect((e as SplitError).code).toBe('SPLIT_SUM_MISMATCH');
      expect((e as SplitError).details).toEqual({ expected: 100, actual: 90 });
    }
  });

  it('shares mode weights by count', () => {
    const shares = computeShares({
      amount: 1000,
      baseAmount: 1000,
      payerId: 'alon',
      members,
      mode: 'shares',
      shares: { alon: 1, noa: 3 },
    });
    expect(shares.map((s) => s.amount)).toEqual([250, 750]);
    expect(shares[1]).toMatchObject({ shares: 3 });
  });

  it('rejects unknown members', () => {
    expect(() =>
      computeShares({ amount: 100, baseAmount: 100, payerId: 'alon', members, mode: 'equal', included: ['ghost'] }),
    ).toThrow(SplitError);
  });
});

describe('Crete seed (handoff §10)', () => {
  const expenses = [
    { id: 'e1', paidByMemberId: 'alon', baseAmount: 480000 },
    { id: 'e2', paidByMemberId: 'noa', baseAmount: 160000 },
    { id: 'e3', paidByMemberId: 'maya', baseAmount: 64000 },
    { id: 'e4', paidByMemberId: 'itay', baseAmount: 112000 },
    { id: 'e5', paidByMemberId: 'itay', baseAmount: 48000 },
    { id: 'e6', paidByMemberId: 'maya', baseAmount: 136000 },
  ];
  const shares = expenses.flatMap((e) =>
    computeShares({ amount: e.baseAmount, baseAmount: e.baseAmount, payerId: e.paidByMemberId, members, mode: 'equal' }).map(
      (s) => ({ expenseId: e.id, memberId: s.memberId, amount: s.amount }),
    ),
  );
  const settlements = [{ fromMemberId: 'maya', toMemberId: 'alon', baseAmount: 50000 }];
  const ids = members.map((m) => m.id);

  it('totals ₪10,000 and ₪2,500 each', () => {
    const balances = computeBalances(ids, expenses, shares, []);
    expect(expenses.reduce((a, e) => a + e.baseAmount, 0)).toBe(1_000_000);
    for (const b of balances) expect(b.share).toBe(250_000);
  });

  it('simplifies to Noa→Alon ₪900 and Itay→Alon ₪900, Maya settled', () => {
    const balances = computeBalances(ids, expenses, shares, settlements);
    expect(balances.find((b) => b.memberId === 'maya')!.net).toBe(0);
    expect(balances.reduce((a, b) => a + b.net, 0)).toBe(0);
    const transfers = simplifyDebts(balances);
    expect(transfers).toEqual([
      { fromMemberId: 'noa', toMemberId: 'alon', amount: 90000 },
      { fromMemberId: 'itay', toMemberId: 'alon', amount: 90000 },
    ]);
  });

  it('ignores deleted expenses', () => {
    const b = computeBalances(ids, [{ ...expenses[0]!, deleted: true }], shares, []);
    expect(b.every((r) => r.paid === 0 && r.share === 0)).toBe(true);
  });
});

describe('invite codes', () => {
  it('round trips', () => {
    expect(formatInviteCode('KR74QX')).toBe('KR7-4QX');
    expect(parseInviteCode('kr7-4qx')).toBe('KR74QX');
    expect(parseInviteCode('KR7-4Q0')).toBeNull();
    expect(parseInviteCode('abc')).toBeNull();
  });
  it('generates valid codes', () => {
    for (let i = 0; i < 50; i++) expect(parseInviteCode(generateInviteCode())).not.toBeNull();
  });
});

describe('expenseDiff', () => {
  const base = {
    description: 'Dinner',
    category: 'food',
    amount: 48000,
    currency: 'ILS',
    fxRate: '1',
    baseAmount: 48000,
    paidByMemberId: 'noa',
    date: '2026-10-17',
    splitMode: 'equal',
    receiptKey: null,
    shares: [
      { memberId: 'noa', amount: 24000 },
      { memberId: 'itay', amount: 24000 },
    ],
  };

  it('reports changed fields and per-member balance moves', () => {
    const after = {
      ...base,
      amount: 52000,
      baseAmount: 52000,
      paidByMemberId: 'itay',
      shares: [
        { memberId: 'noa', amount: 26000 },
        { memberId: 'itay', amount: 26000 },
      ],
    };
    const d = expenseDiff(base, after);
    expect(Object.keys(d.fields).sort()).toEqual(['amount', 'baseAmount', 'paidByMemberId', 'shares']);
    expect(d.fields.amount).toEqual([48000, 52000]);
    // noa: +24000 → −26000, itay: −24000 → +26000
    expect(d.netChanges).toEqual([
      { memberId: 'noa', before: 24000, after: -26000 },
      { memberId: 'itay', before: -24000, after: 26000 },
    ]);
  });

  it('reports nothing for an identical expense', () => {
    expect(expenseDiff(base, { ...base })).toEqual({ fields: {}, netChanges: [] });
  });

  it('treats delete as every effect going to zero', () => {
    const d = expenseDiff(base, null);
    expect(d.fields).toEqual({});
    expect(d.netChanges).toEqual([
      { memberId: 'noa', before: 24000, after: 0 },
      { memberId: 'itay', before: -24000, after: 0 },
    ]);
  });
});

describe('pay options', () => {
  it('builds PayPal with amount and copy-only for Bit', () => {
    const o = buildPayOptions({ paypalMe: '@alon', bitPhone: '050-1234567', bankDetails: 'Leumi 10 123' }, 34000, 'ILS');
    expect(o.find((x) => x.method === 'paypal')?.url).toBe('https://paypal.me/alon/340.00ILS');
    expect(o.find((x) => x.method === 'bit')).toMatchObject({ copyText: '050-1234567\n340.00 ILS', amountPrefilled: false });
    expect(o.find((x) => x.method === 'bit')?.url).toBeUndefined();
    expect(buildPayOptions(null, 100, 'ILS')).toEqual([]);
  });

  it('formats major units for 0 and 3 decimal currencies', () => {
    expect(toMajorString(1000, 'JPY')).toBe('1000');
    expect(toMajorString(1234, 'KWD')).toBe('1.234');
    expect(toMajorString(5, 'ILS')).toBe('0.05');
  });
});

describe('reminders', () => {
  const base = { locale: 'en', debtorName: 'Noa', creditorName: 'Alon', amount: 90000, currency: 'ILS', groupName: 'Crete trip' } as const;

  it('renders each tone in both locales', () => {
    for (const tone of ['friendly', 'neutral', 'firm'] as const) {
      for (const locale of ['en', 'he'] as const) {
        const text = renderReminder({ ...base, tone, locale });
        expect(text).toContain('Noa');
        expect(text).toContain('Crete trip');
        expect(text).toMatch(/900/);
      }
    }
  });

  it('agrees Hebrew grammar with gender', () => {
    expect(renderReminder({ ...base, tone: 'friendly', locale: 'he', gender: 'female' })).toContain('את חייבת');
    expect(renderReminder({ ...base, tone: 'friendly', locale: 'he', gender: 'male' })).toContain('אתה חייב');
    expect(renderReminder({ ...base, tone: 'friendly', locale: 'he' })).toContain('את/ה חייב/ת');
  });

  it('appends payment details once', () => {
    const d = { bitPhone: '0501234567' };
    const once = appendPaymentDetails('Please pay', d, 'en');
    expect(once).toContain('Bit: 0501234567');
    expect(appendPaymentDetails(once, d, 'en')).toBe(once);
    expect(appendPaymentDetails('Please pay', null, 'en')).toBe('Please pay');
  });

  it('builds wa.me and sms links', () => {
    expect(whatsappLink('+972501234567', 'hi there')).toBe('https://wa.me/972501234567?text=hi%20there');
    expect(smsLink('+972501234567', 'hi')).toBe('sms:+972501234567?body=hi');
    expect(smsLink('+972501234567', 'hi', 'ios')).toBe('sms:+972501234567&body=hi');
  });
});
