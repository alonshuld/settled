import { Injectable } from '@nestjs/common';
import { Prisma, type Category, type Expense, type ExpenseShare, type FxSource, type SplitMode } from '@prisma/client';
import {
  computeShares,
  convert,
  expenseDiff,
  isCurrency,
  SplitError,
  type ComputedShare,
  type DiffableExpense,
} from '@settled/core';
import type { GroupMember } from '../common/decorators';
import { AppError } from '../common/errors';
import { FxService } from '../fx/fx.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReceiptsService } from '../uploads/receipts.service';

export type SplitInput =
  | { mode: 'equal'; included: string[] }
  | { mode: 'exact'; amounts: Record<string, number> }
  | { mode: 'shares'; shares: Record<string, number> };

export interface CreateExpense {
  amount: number;
  currency?: string;
  /** Decimal string = manual rate; null / absent = market rate for `date`. */
  fxRate?: string | null;
  description: string;
  category: Category;
  paidByMemberId: string;
  date: string;
  receiptKey?: string | null;
  split: SplitInput;
}

export type UpdateExpense = Partial<CreateExpense> & { version: number };

export interface ListQuery {
  cursor?: string;
  limit: number;
  category?: Category;
  memberId?: string;
}

type ExpenseRow = Expense & { shares: ExpenseShare[] };

const day = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);

/** Fields of a stored expense that `expenseDiff` compares. */
function snapshot(e: ExpenseRow): DiffableExpense {
  return {
    description: e.description,
    category: e.category,
    amount: e.amount,
    currency: e.currency,
    fxRate: e.fxRate.toFixed(),
    baseAmount: e.baseAmount,
    paidByMemberId: e.paidByMemberId,
    date: day(e.date),
    splitMode: e.splitMode,
    receiptKey: e.receiptKey,
    shares: e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })),
  };
}

/** The split a stored expense was entered with, so an edit that doesn't resend `split` keeps it. */
function storedSplit(e: ExpenseRow): SplitInput {
  if (e.splitMode === 'exact') return { mode: 'exact', amounts: Object.fromEntries(e.shares.map((s) => [s.memberId, s.originalAmount ?? 0])) };
  if (e.splitMode === 'shares') return { mode: 'shares', shares: Object.fromEntries(e.shares.map((s) => [s.memberId, s.shares ?? 0])) };
  return { mode: 'equal', included: e.shares.map((s) => s.memberId) };
}

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly receipts: ReceiptsService,
  ) {}

  // ---- serialiser ----------------------------------------------------------

  view(e: ExpenseRow, receiptUrl?: string | null) {
    const out = {
      id: e.id,
      groupId: e.groupId,
      description: e.description,
      category: e.category,
      amount: e.amount,
      currency: e.currency,
      fxRate: e.fxRate.toFixed(),
      fxSource: e.fxSource,
      fxDate: e.fxDate ? day(e.fxDate) : null,
      baseAmount: e.baseAmount,
      paidByMemberId: e.paidByMemberId,
      date: day(e.date),
      hasReceipt: e.receiptKey !== null,
      receiptKey: e.receiptKey,
      splitMode: e.splitMode,
      shares: [...e.shares]
        .sort((a, b) => a.memberId.localeCompare(b.memberId))
        .map((s) => ({ memberId: s.memberId, amount: s.amount, originalAmount: s.originalAmount, shares: s.shares })),
      createdByMemberId: e.createdById,
      version: e.version,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
    return receiptUrl === undefined ? out : { ...out, receiptUrl };
  }

  // ---- reads ---------------------------------------------------------------

  async list(groupId: string, q: ListQuery) {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const where: Prisma.ExpenseWhereInput = {
      groupId,
      deletedAt: null,
      ...(q.category ? { category: q.category } : {}),
      ...(q.memberId ? { OR: [{ paidByMemberId: q.memberId }, { shares: { some: { memberId: q.memberId } } }] } : {}),
    };
    const rows = await this.prisma.expense.findMany({
      where: cursor
        ? {
            AND: [
              where,
              {
                OR: [
                  { date: { lt: cursor.date } },
                  { date: cursor.date, createdAt: { lt: cursor.createdAt } },
                  { date: cursor.date, createdAt: cursor.createdAt, id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : where,
      include: { shares: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((e) => this.view(e)),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(groupId: string, expenseId: string) {
    const e = await this.load(groupId, expenseId);
    return this.view(e, await this.receipts.viewUrl(e.receiptKey));
  }

  // ---- writes --------------------------------------------------------------

  async create(me: GroupMember, input: CreateExpense) {
    const group = await this.openGroup(me.groupId);
    const members = await this.activeMembers(me.groupId);
    const resolved = await this.resolve(group.currency, {
      amount: input.amount,
      currency: input.currency ?? group.currency,
      date: input.date,
      fxRate: input.fxRate ?? null,
      paidByMemberId: input.paidByMemberId,
      split: input.split,
      members,
    });
    this.checkReceipt(me.groupId, input.receiptKey);

    return this.prisma.transaction(async (tx) => {
      const created = await tx.expense.create({
        data: {
          groupId: me.groupId,
          description: input.description,
          category: input.category,
          amount: input.amount,
          currency: resolved.currency,
          fxRate: resolved.fxRate,
          fxSource: resolved.fxSource,
          fxDate: resolved.fxDate,
          baseAmount: resolved.baseAmount,
          paidByMemberId: input.paidByMemberId,
          date: toDate(input.date),
          receiptKey: input.receiptKey ?? null,
          splitMode: input.split.mode,
          createdById: me.id,
          shares: { create: resolved.shares.map(shareRow) },
        },
        include: { shares: true },
      });
      const names = nameMap(members);
      await tx.activity.create({
        data: {
          groupId: me.groupId,
          actorMemberId: me.id,
          type: 'expense',
          event: 'expense.created',
          payload: {
            expenseId: created.id,
            description: created.description,
            category: created.category,
            amount: created.amount,
            currency: created.currency,
            baseAmount: created.baseAmount,
            groupCurrency: group.currency,
            paidByMemberId: created.paidByMemberId,
            paidBy: names.get(created.paidByMemberId) ?? '',
            actor: names.get(me.id) ?? '',
            // Everyone whose balance this moves: step 6's fan-out always notifies them (design §9.5.1)
            affectedMemberIds: affected(created.paidByMemberId, created.shares),
          },
        },
      });
      return this.view(created, null);
    });
  }

  async update(me: GroupMember, expenseId: string, input: UpdateExpense) {
    const group = await this.openGroup(me.groupId);
    const before = await this.load(me.groupId, expenseId);
    if (before.version !== input.version) {
      throw new AppError('VERSION_CONFLICT', 409, 'Expense was changed by someone else', { currentVersion: before.version });
    }

    // Members of this expense may have left since; they stay valid for this expense
    const members = await this.activeMembers(me.groupId, [before.paidByMemberId, ...before.shares.map((s) => s.memberId)]);
    const currency = input.currency ?? before.currency;
    const amount = input.amount ?? before.amount;
    const date = input.date ?? day(before.date);
    const paidByMemberId = input.paidByMemberId ?? before.paidByMemberId;

    // The rate is locked at save time. It is re-resolved only when amount, currency or date is edited,
    // and a manual rate survives such edits unless the currency changes or a new rate is sent.
    const touchesRate = input.amount !== undefined || input.currency !== undefined || input.date !== undefined;
    const sameCurrency = currency === before.currency;
    let fxRate: string | null = null;
    let locked: { rate: string; source: FxSource; date: Date | null } | undefined;
    if (input.fxRate !== undefined) fxRate = input.fxRate;
    else if (before.fxSource === 'manual' && sameCurrency) fxRate = before.fxRate.toFixed();
    else if (!touchesRate && sameCurrency) locked = { rate: before.fxRate.toFixed(), source: before.fxSource, date: before.fxDate };

    const resolved = await this.resolve(group.currency, {
      amount,
      currency,
      date,
      fxRate,
      paidByMemberId,
      split: input.split ?? storedSplit(before),
      members,
      locked,
    });
    const receiptKey = input.receiptKey === undefined ? before.receiptKey : input.receiptKey;
    if (input.receiptKey !== undefined) this.checkReceipt(me.groupId, receiptKey);

    return this.prisma.transaction(async (tx) => {
      const claimed = await tx.expense.updateMany({
        where: { id: before.id, version: input.version, deletedAt: null },
        data: {
          description: input.description ?? before.description,
          category: input.category ?? before.category,
          amount,
          currency: resolved.currency,
          fxRate: resolved.fxRate,
          fxSource: resolved.fxSource,
          fxDate: resolved.fxDate,
          baseAmount: resolved.baseAmount,
          paidByMemberId,
          date: toDate(date),
          receiptKey,
          splitMode: (input.split ?? storedSplit(before)).mode,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) throw new AppError('VERSION_CONFLICT', 409, 'Expense was changed by someone else');
      await tx.expenseShare.deleteMany({ where: { expenseId: before.id } });
      await tx.expenseShare.createMany({ data: resolved.shares.map((s) => ({ ...shareRow(s), expenseId: before.id })) });
      const after = await tx.expense.findUniqueOrThrow({ where: { id: before.id }, include: { shares: true } });

      const diff = expenseDiff(snapshot(before), snapshot(after));
      if (Object.keys(diff.fields).length > 0) {
        const names = nameMap(members);
        await tx.activity.create({
          data: {
            groupId: me.groupId,
            actorMemberId: me.id,
            type: 'expense',
            event: 'expense.updated',
            payload: this.changePayload(after, group.currency, names, me.id, diff, before),
          },
        });
      }
      return this.view(after, null);
    });
  }

  async remove(me: GroupMember, expenseId: string) {
    const group = await this.openGroup(me.groupId);
    const before = await this.load(me.groupId, expenseId);
    const members = await this.activeMembers(me.groupId, [before.paidByMemberId, ...before.shares.map((s) => s.memberId)]);
    await this.prisma.transaction(async (tx) => {
      const claimed = await tx.expense.updateMany({
        where: { id: before.id, deletedAt: null },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      if (claimed.count === 0) throw new AppError('NOT_FOUND', 404);
      const diff = expenseDiff(snapshot(before), null);
      await tx.activity.create({
        data: {
          groupId: me.groupId,
          actorMemberId: me.id,
          type: 'expense',
          event: 'expense.deleted',
          payload: this.changePayload(before, group.currency, nameMap(members), me.id, diff),
        },
      });
    });
  }

  // ---- internals -----------------------------------------------------------

  /** Activity payload for an edit or delete (design §9.5.1): editor, field diff, and each member's balance change. */
  private changePayload(
    e: ExpenseRow,
    groupCurrency: string,
    names: Map<string, string>,
    actorId: string,
    diff: ReturnType<typeof expenseDiff>,
    before?: ExpenseRow,
  ) {
    const fields: Record<string, unknown> = { ...diff.fields };
    // Show names, not ids, for the payer
    if (fields.paidByMemberId) {
      const [a, b] = fields.paidByMemberId as [string, string];
      fields.paidBy = [names.get(a) ?? a, names.get(b) ?? b];
      delete fields.paidByMemberId;
    }
    const involved = new Set([
      ...affected(e.paidByMemberId, e.shares),
      ...(before ? affected(before.paidByMemberId, before.shares) : []),
      ...diff.netChanges.map((c) => c.memberId),
    ]);
    return {
      expenseId: e.id,
      description: e.description,
      currency: e.currency,
      amount: e.amount,
      baseAmount: e.baseAmount,
      groupCurrency,
      actor: names.get(actorId) ?? '',
      diff: fields as Prisma.InputJsonObject,
      netChanges: diff.netChanges.map((c) => ({ ...c, name: names.get(c.memberId) ?? '' })),
      affectedMemberIds: [...involved],
    } satisfies Prisma.InputJsonObject;
  }

  private async openGroup(groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { id: true, currency: true, closedAt: true } });
    if (group.closedAt) throw new AppError('GROUP_CLOSED', 409);
    return group;
  }

  /** Active members, plus `extra` ids that must stay valid even if the member has since left. */
  private activeMembers(groupId: string, extra: string[] = []) {
    return this.prisma.member.findMany({
      where: { groupId, OR: [{ leftAt: null }, { id: { in: extra } }] },
      select: { id: true, displayName: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  private async load(groupId: string, expenseId: string): Promise<ExpenseRow> {
    // groupId comes from the guard-verified member, so another group's expense is simply "not found"
    const e = await this.prisma.expense.findFirst({ where: { id: expenseId, groupId, deletedAt: null }, include: { shares: true } });
    if (!e) throw new AppError('NOT_FOUND', 404);
    return e;
  }

  private checkReceipt(groupId: string, key: string | null | undefined) {
    if (key && !this.receipts.keyBelongsTo(key, groupId)) {
      throw new AppError('VALIDATION_FAILED', 400, 'Receipt belongs to another group', { fields: { receiptKey: ['Invalid receipt'] } });
    }
  }

  /** Currency, rate and conversion, then the final shares. Nothing here touches the database except rate lookups. */
  private async resolve(
    groupCurrency: string,
    i: {
      amount: number;
      currency: string;
      date: string;
      fxRate: string | null;
      paidByMemberId: string;
      split: SplitInput;
      members: { id: string; sortOrder: number }[];
      /** Keep this stored rate instead of looking one up. */
      locked?: { rate: string; source: FxSource; date: Date | null };
    },
  ) {
    if (!isCurrency(i.currency)) throw new AppError('UNSUPPORTED_CURRENCY', 400, `Unsupported currency: ${i.currency}`);

    let rate: string;
    let fxSource: FxSource;
    let fxDate: Date | null = null;
    if (i.currency === groupCurrency) {
      rate = '1';
      fxSource = 'same';
    } else if (i.fxRate !== null) {
      rate = i.fxRate;
      fxSource = 'manual';
    } else if (i.locked) {
      rate = i.locked.rate;
      fxSource = i.locked.source;
      fxDate = i.locked.date;
    } else {
      const r = await this.fx.rateFor(i.currency, groupCurrency, i.date);
      rate = r.rate;
      fxSource = 'market';
      fxDate = r.date ? toDate(r.date) : null;
    }

    const baseAmount = convert(i.amount, i.currency, groupCurrency, rate);
    if (baseAmount < 1) {
      throw new AppError('VALIDATION_FAILED', 400, 'Amount is too small to convert', { fields: { amount: ['Too small'] } });
    }

    const ids = new Set(i.members.map((m) => m.id));
    const mentioned =
      i.split.mode === 'equal' ? i.split.included : Object.keys(i.split.mode === 'exact' ? i.split.amounts : i.split.shares);
    const strangers = [i.paidByMemberId, ...mentioned].filter((id) => !ids.has(id));
    if (strangers.length > 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'Payer and split must be members of this group', { fields: { members: [...new Set(strangers)] } });
    }

    let shares: ComputedShare[];
    try {
      shares = computeShares({
        amount: i.amount,
        baseAmount,
        payerId: i.paidByMemberId,
        members: i.members.map((m) => ({ id: m.id, order: m.sortOrder })),
        mode: i.split.mode,
        included: i.split.mode === 'equal' ? i.split.included : undefined,
        exact: i.split.mode === 'exact' ? i.split.amounts : undefined,
        shares: i.split.mode === 'shares' ? i.split.shares : undefined,
      });
    } catch (e) {
      if (e instanceof SplitError) throw new AppError(e.code, 400, e.message, e.details);
      throw e;
    }
    return { currency: i.currency, fxRate: new Prisma.Decimal(rate), fxSource, fxDate, baseAmount, shares };
  }
}

const shareRow = (s: ComputedShare) => ({
  memberId: s.memberId,
  amount: s.amount,
  originalAmount: s.originalAmount ?? null,
  shares: s.shares ?? null,
});

const nameMap = (members: { id: string; displayName: string }[]) => new Map(members.map((m) => [m.id, m.displayName]));

/** Payer and everyone with a share. */
const affected = (paidBy: string, shares: { memberId: string }[]) => [...new Set([paidBy, ...shares.map((s) => s.memberId)])];

function encodeCursor(e: Expense) {
  return Buffer.from(`${day(e.date)}|${e.createdAt.toISOString()}|${e.id}`).toString('base64url');
}

function decodeCursor(cursor: string) {
  const [d, c, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const date = d ? toDate(d) : null;
  const createdAt = c ? new Date(c) : null;
  if (!date || !createdAt || !id || Number.isNaN(date.getTime()) || Number.isNaN(createdAt.getTime())) {
    throw new AppError('VALIDATION_FAILED', 400, 'Invalid cursor', { fields: { cursor: ['Invalid cursor'] } });
  }
  return { date, createdAt, id };
}
