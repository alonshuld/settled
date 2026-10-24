import { computeShares, convert, decimalsOf, isCurrency, SplitError, toMajorString } from '@settled/core';
import type { Category, Expense, SplitMode } from '@/api/expenses';

// Limits and the rate format mirror the Zod schemas in apps/api/src/expenses/expenses.controller.ts.
export const MAX_AMOUNT = 100_000_000;
export const MAX_SHARES = 1000;
export const MAX_DESCRIPTION = 120;
const RATE_RE = /^(?!0+(\.0+)?$)\d{1,10}(\.\d{1,10})?$/;

export interface ExpenseDraft {
  /** Major units as typed ("12.50"). */
  amount: string;
  currency: string;
  /** A rate the user typed; null means "use the market rate". */
  rate: string | null;
  description: string;
  category: Category;
  paidBy: string;
  /** `YYYY-MM-DD`. */
  date: string;
  mode: SplitMode;
  /** Equal mode: member ids in the split. */
  included: string[];
  /** Exact mode: typed amounts in the expense currency, keyed by member id. */
  exact: Record<string, string>;
  /** Shares mode: whole shares per member id (0 = not in the split). */
  shares: Record<string, number>;
  receiptKey: string | null;
}

export interface FormContext {
  groupCurrency: string;
  /** Members shown in the split, in the group's order (the order the server breaks ties in). */
  memberIds: string[];
  /** Rate for `draft.currency` -> group currency when the user hasn't typed one. */
  marketRate: string | null;
}

export type ErrorField = 'amount' | 'description' | 'date' | 'rate' | 'split' | 'paidBy';
export interface FormError {
  /** Key under `expense.err.*`. */
  code: string;
  params?: Record<string, string | number>;
}
export type FormErrors = Partial<Record<ErrorField, FormError>>;

export interface Computed {
  /** The typed amount in minor units, or null while it's missing / invalid. */
  minor: number | null;
  /** Converted to the group's currency. */
  baseMinor: number | null;
  /** The rate the conversion used ('1' for the group's own currency). */
  rate: string | null;
  /** Each participant's share in the group's currency; null until the split is valid. */
  shares: Map<string, number> | null;
  /** Exact mode: what the typed amounts add up to (expense currency, minor units). */
  exactSum: number;
  errors: FormErrors;
  valid: boolean;
}

export type AmountResult = { minor: number } | { error: 'empty' | 'invalid' | 'decimals' | 'tooLarge' };

const decimals = (currency: string) => (isCurrency(currency) ? decimalsOf(currency) : 2);

/** "12.5" / "12,5" / "1,250.75" -> minor units. Empty input is an error; callers decide whether that matters. */
export function parseAmount(input: string, currency: string): AmountResult {
  const d = decimals(currency);
  let s = input.replace(/\s/g, '');
  if (!s) return { error: 'empty' };
  if (s.includes(',') && !s.includes('.')) {
    // A lone comma followed by at most `d` digits is a decimal comma ("12,5"); anything else is grouping ("1,250").
    const decimalComma = d > 0 && new RegExp(`^\\d*,\\d{1,${d}}$`).test(s);
    s = decimalComma ? s.replace(',', '.') : s.replaceAll(',', '');
  } else {
    s = s.replaceAll(',', '');
  }
  const m = /^(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return { error: 'invalid' };
  const int = m[1] ?? '';
  const frac = m[2] ?? '';
  if (frac.length > d) return { error: 'decimals' };
  if (int.replace(/^0+/, '').length > 10) return { error: 'tooLarge' };
  const minor = Number(int || '0') * 10 ** d + Number(frac.padEnd(d, '0') || '0');
  return minor > MAX_AMOUNT ? { error: 'tooLarge' } : { minor };
}

/** What the amount field should accept as you type: digits and one decimal separator. */
export const sanitizeAmount = (input: string) => input.replace(/[^\d.,]/g, '');

export const isValidRate = (rate: string) => RATE_RE.test(rate);

export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function emptyDraft(opts: { currency: string; memberIds: string[]; paidBy: string; date?: string }): ExpenseDraft {
  return {
    amount: '',
    currency: opts.currency,
    rate: null,
    description: '',
    category: 'food',
    paidBy: opts.paidBy,
    date: opts.date ?? localDate(),
    mode: 'equal',
    included: [...opts.memberIds],
    exact: Object.fromEntries(opts.memberIds.map((id) => [id, ''])),
    shares: Object.fromEntries(opts.memberIds.map((id) => [id, 1])),
    receiptKey: null,
  };
}

export function draftFromExpense(e: Expense, memberIds: string[]): ExpenseDraft {
  const base = emptyDraft({ currency: e.currency, memberIds, paidBy: e.paidByMemberId, date: e.date });
  const byMember = new Map(e.shares.map((s) => [s.memberId, s]));
  const draft: ExpenseDraft = {
    ...base,
    amount: toMajorString(e.amount, e.currency),
    // Only a hand-typed rate is the user's to keep; a market rate stays "automatic".
    rate: e.fxSource === 'manual' ? e.fxRate : null,
    description: e.description,
    category: e.category,
    mode: e.splitMode,
    receiptKey: e.receiptKey,
  };
  if (e.splitMode === 'equal') {
    draft.included = memberIds.filter((id) => byMember.has(id));
  } else if (e.splitMode === 'exact') {
    draft.exact = Object.fromEntries(
      memberIds.map((id) => {
        const v = byMember.get(id)?.originalAmount ?? 0;
        return [id, v > 0 ? toMajorString(v, e.currency) : ''];
      }),
    );
  } else {
    draft.shares = Object.fromEntries(memberIds.map((id) => [id, byMember.get(id)?.shares ?? 0]));
  }
  return draft;
}

export const draftSignature = (d: ExpenseDraft) => JSON.stringify(d);

const err = (code: string, params?: FormError['params']): FormError => ({ code, params });

const amountError = (e: Extract<AmountResult, { error: string }>['error']) =>
  err(e === 'empty' ? 'amountRequired' : e === 'decimals' ? 'amountDecimals' : e === 'tooLarge' ? 'amountTooLarge' : 'amountInvalid');

/**
 * The live preview and every validation in one pass. Shares come from `computeShares` in `@settled/core`,
 * the same function the server runs, so what you see is what gets stored (remainder cents included).
 */
export function computeExpense(draft: ExpenseDraft, ctx: FormContext): Computed {
  const errors: FormErrors = {};
  const supported = isCurrency(draft.currency);
  const foreign = draft.currency !== ctx.groupCurrency;

  let minor: number | null = null;
  const parsed = parseAmount(draft.amount, draft.currency);
  if ('minor' in parsed) {
    if (parsed.minor > 0) minor = parsed.minor;
    else errors.amount = err('amountZero');
  } else {
    errors.amount = amountError(parsed.error);
  }

  if (!draft.description.trim()) errors.description = err('descriptionRequired');
  if (!isDate(draft.date)) errors.date = err('dateRequired');
  if (!ctx.memberIds.includes(draft.paidBy)) errors.paidBy = err('payerRequired');
  if (!supported) errors.amount ??= err('currencyUnsupported');

  let rate: string | null = '1';
  if (foreign) {
    rate = draft.rate !== null ? draft.rate : ctx.marketRate;
    if (rate === null || rate === '') errors.rate = err('rateMissing');
    else if (!isValidRate(rate)) errors.rate = err('rateInvalid');
  }
  const rateOk = rate !== null && !errors.rate;

  let baseMinor: number | null = null;
  if (minor !== null && supported && rateOk) {
    baseMinor = convert(minor, draft.currency, ctx.groupCurrency, rate!);
    if (baseMinor < 1) {
      errors.amount ??= err('amountTooSmall');
      baseMinor = null;
    }
  }

  // Split-specific input, validated in the expense currency (that is what the server checks too).
  const exact: Record<string, number> = {};
  let exactSum = 0;
  const shares: Record<string, number> = {};
  if (draft.mode === 'exact') {
    for (const id of ctx.memberIds) {
      const raw = draft.exact[id] ?? '';
      if (raw.trim() === '') continue;
      const p = parseAmount(raw, draft.currency);
      if ('error' in p) errors.split ??= err('exactInvalid');
      else if (p.minor > 0) {
        exact[id] = p.minor;
        exactSum += p.minor;
      }
    }
    if (!errors.split) {
      if (exactSum === 0) errors.split = err('exactNone');
      else if (minor !== null && exactSum !== minor) {
        errors.split = err(exactSum < minor ? 'exactUnder' : 'exactOver', { diff: Math.abs(minor - exactSum) });
      }
    }
  } else if (draft.mode === 'shares') {
    for (const id of ctx.memberIds) {
      const n = Math.min(MAX_SHARES, Math.max(0, Math.trunc(draft.shares[id] ?? 0)));
      if (n > 0) shares[id] = n;
    }
    if (Object.keys(shares).length === 0) errors.split = err('sharesNone');
  } else if (!draft.included.some((id) => ctx.memberIds.includes(id))) {
    errors.split = err('equalNone');
  }

  let computed: Map<string, number> | null = null;
  if (baseMinor !== null && minor !== null && !errors.split && !errors.paidBy) {
    try {
      const out = computeShares({
        amount: minor,
        baseAmount: baseMinor,
        payerId: draft.paidBy,
        members: ctx.memberIds.map((id, order) => ({ id, order })),
        mode: draft.mode,
        included: draft.mode === 'equal' ? draft.included : undefined,
        exact: draft.mode === 'exact' ? exact : undefined,
        shares: draft.mode === 'shares' ? shares : undefined,
      });
      computed = new Map(out.map((s) => [s.memberId, s.amount]));
    } catch (e) {
      if (!(e instanceof SplitError)) throw e;
      errors.split = err(e.code === 'SPLIT_SUM_MISMATCH' ? 'exactUnder' : 'equalNone', { diff: 0 });
    }
  }

  return {
    minor,
    baseMinor,
    rate: rateOk ? rate : null,
    shares: computed,
    exactSum,
    errors,
    valid: Object.keys(errors).length === 0 && computed !== null,
  };
}

export type SplitBody =
  | { mode: 'equal'; included: string[] }
  | { mode: 'exact'; amounts: Record<string, number> }
  | { mode: 'shares'; shares: Record<string, number> };

export interface CreateBody {
  amount: number;
  currency: string;
  fxRate?: string | null;
  description: string;
  category: Category;
  paidByMemberId: string;
  date: string;
  receiptKey: string | null;
  split: SplitBody;
}
export type UpdateBody = Partial<Omit<CreateBody, 'split'>> & { split: SplitBody; version: number };

function splitBody(draft: ExpenseDraft, ctx: FormContext): SplitBody {
  if (draft.mode === 'equal') return { mode: 'equal', included: ctx.memberIds.filter((id) => draft.included.includes(id)) };
  if (draft.mode === 'exact') {
    const amounts: Record<string, number> = {};
    for (const id of ctx.memberIds) {
      const p = parseAmount(draft.exact[id] ?? '', draft.currency);
      if ('minor' in p && p.minor > 0) amounts[id] = p.minor;
    }
    return { mode: 'exact', amounts };
  }
  const shares: Record<string, number> = {};
  for (const id of ctx.memberIds) {
    const n = Math.min(MAX_SHARES, Math.trunc(draft.shares[id] ?? 0));
    if (n > 0) shares[id] = n;
  }
  return { mode: 'shares', shares };
}

/** Call only when `computeExpense(...).valid`. A market rate is never sent: the server looks it up for the date. */
export function buildCreateBody(draft: ExpenseDraft, ctx: FormContext): CreateBody {
  const foreign = draft.currency !== ctx.groupCurrency;
  const parsed = parseAmount(draft.amount, draft.currency);
  return {
    amount: 'minor' in parsed ? parsed.minor : 0,
    currency: draft.currency,
    ...(foreign && draft.rate !== null && { fxRate: draft.rate }),
    description: draft.description.trim(),
    category: draft.category,
    paidByMemberId: draft.paidBy,
    date: draft.date,
    receiptKey: draft.receiptKey,
    split: splitBody(draft, ctx),
  };
}

/**
 * Only what changed, plus the split and `version`. The server re-resolves the rate whenever amount, currency or
 * date are sent, and keeps the locked one otherwise, so untouched fields are left out on purpose.
 */
export function buildUpdateBody(draft: ExpenseDraft, original: Expense, ctx: FormContext): UpdateBody {
  const full = buildCreateBody(draft, ctx);
  const body: UpdateBody = { split: full.split, version: original.version };
  if (full.amount !== original.amount) body.amount = full.amount;
  if (full.currency !== original.currency) body.currency = full.currency;
  if (full.description !== original.description) body.description = full.description;
  if (full.category !== original.category) body.category = full.category;
  if (full.paidByMemberId !== original.paidByMemberId) body.paidByMemberId = full.paidByMemberId;
  if (full.date !== original.date) body.date = full.date;
  if (full.receiptKey !== original.receiptKey) body.receiptKey = full.receiptKey;

  if (draft.currency !== ctx.groupCurrency) {
    const keptManual = original.fxSource === 'manual' && original.currency === draft.currency;
    if (draft.rate !== null) {
      if (!(keptManual && draft.rate === original.fxRate)) body.fxRate = draft.rate;
    } else if (keptManual) {
      body.fxRate = null; // back to the market rate
    }
  }
  return body;
}
