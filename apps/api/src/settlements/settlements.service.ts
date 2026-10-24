import { Injectable } from '@nestjs/common';
import { Prisma, type PaymentMethod, type Settlement } from '@prisma/client';
import { buildPayOptions, convert, isCurrency } from '@settled/core';
import type { GroupMember } from '../common/decorators';
import { AppError } from '../common/errors';
import { FxService } from '../fx/fx.service';
import { BalancesService } from '../groups/balances.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSettlement {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency?: string;
  fxRate?: string | null;
  method?: PaymentMethod | null;
}

/** Rate differences between the day a payment is agreed and the day it is made must not leave "₪0.37 owed" (design §9.8). */
const TOLERANCE = 0.01;
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * If a payment lands within the tolerance of what is owed, count exactly what is owed so the remainder is written off.
 * Returns null when the payment is more than the tolerance above the outstanding amount.
 */
export function fitToOutstanding(baseAmount: number, outstanding: number): number | null {
  if (baseAmount > Math.floor(outstanding * (1 + TOLERANCE))) return null;
  if (outstanding - baseAmount <= Math.floor(outstanding * TOLERANCE)) return outstanding;
  return baseAmount;
}

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fx: FxService,
    private readonly balances: BalancesService,
  ) {}

  view(s: Settlement) {
    return {
      id: s.id,
      groupId: s.groupId,
      fromMemberId: s.fromMemberId,
      toMemberId: s.toMemberId,
      amount: s.amount,
      currency: s.currency,
      fxRate: s.fxRate.toFixed(),
      fxSource: s.fxSource,
      baseAmount: s.baseAmount,
      method: s.method,
      status: s.status,
      createdByMemberId: s.createdById,
      confirmedAt: s.confirmedAt,
      createdAt: s.createdAt,
    };
  }

  // ---- settle-up view (design §9.7) ---------------------------------------

  async settleView(me: GroupMember) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId }, select: { currency: true } });
    const [transfers, confirmed, pending, reminders, members, mine] = await Promise.all([
      this.balances.transfers(me.groupId),
      this.prisma.settlement.findMany({ where: { groupId: me.groupId, status: 'confirmed' }, orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }] }),
      this.prisma.settlement.findMany({ where: { groupId: me.groupId, status: 'pending' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.reminder.findMany({ where: { groupId: me.groupId, status: { not: 'failed' } }, orderBy: { createdAt: 'desc' } }),
      this.prisma.member.findMany({ where: { groupId: me.groupId }, select: { id: true, userId: true } }),
      this.prisma.paymentDetails.findUnique({ where: { userId: me.userId } }),
    ]);

    const outstanding = transfers.map((t) => {
      // A reminder goes creditor → debtor
      const pair = reminders.filter((r) => r.fromMemberId === t.toMemberId && r.toMemberId === t.fromMemberId);
      const last = pair[0];
      const claim = pending.find((p) => p.fromMemberId === t.fromMemberId && p.toMemberId === t.toMemberId);
      return {
        ...t,
        lastReminder: last
          ? { sentAt: last.sentAt ?? last.createdAt, channel: last.channel, autoRepeat: pair.some((r) => r.nextRunAt !== null && r.stoppedAt === null) }
          : null,
        pendingClaim: claim ? { settlementId: claim.id, amount: claim.baseAmount } : null,
      };
    });

    const myTransfers = transfers.filter((t) => t.fromMemberId === me.id);
    const creditorUser = new Map(members.map((m) => [m.id, m.userId]));
    const creditorIds = [...new Set(myTransfers.map((t) => creditorUser.get(t.toMemberId)).filter((u): u is string => Boolean(u)))];
    const details = await this.prisma.paymentDetails.findMany({ where: { userId: { in: creditorIds } } });
    const detailsOf = new Map(details.map((d) => [d.userId, d]));

    const settledTotal = confirmed.reduce((sum, s) => sum + s.baseAmount, 0);
    return {
      currency: group.currency,
      outstanding,
      settled: confirmed.map((s) => ({
        settlementId: s.id,
        fromMemberId: s.fromMemberId,
        toMemberId: s.toMemberId,
        amount: s.amount,
        currency: s.currency,
        baseAmount: s.baseAmount,
        confirmedAt: s.confirmedAt,
      })),
      progress: { settled: settledTotal, total: settledTotal + transfers.reduce((sum, t) => sum + t.amount, 0) },
      myPaymentDetails: mine ? paymentFields(mine) : null,
      myPayOptions: myTransfers.map((t) => {
        const userId = creditorUser.get(t.toMemberId);
        const d = userId ? detailsOf.get(userId) : undefined;
        return { toMemberId: t.toMemberId, amount: t.amount, currency: group.currency, options: buildPayOptions(d, t.amount, group.currency) };
      }),
    };
  }

  // ---- writes -------------------------------------------------------------

  async create(me: GroupMember, input: CreateSettlement) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId }, select: { id: true, currency: true, closedAt: true } });
    if (group.closedAt) throw new AppError('GROUP_CLOSED', 409);
    if (input.fromMemberId === input.toMemberId) {
      throw new AppError('VALIDATION_FAILED', 400, 'Cannot pay yourself', { fields: { toMemberId: ['Must differ from the payer'] } });
    }
    // Creditor records money received; debtor claims they paid. Nobody else can speak for the pair.
    const asCreditor = input.toMemberId === me.id;
    const asDebtor = input.fromMemberId === me.id;
    if (!asCreditor && !asDebtor) throw new AppError('FORBIDDEN', 403, 'Only the payer or the receiver can record a payment');

    const members = await this.prisma.member.findMany({
      where: { groupId: me.groupId, id: { in: [input.fromMemberId, input.toMemberId] }, leftAt: null },
      select: { id: true, displayName: true },
    });
    if (members.length !== 2) throw new AppError('VALIDATION_FAILED', 400, 'Both people must be members of this group');

    const currency = input.currency ?? group.currency;
    if (!isCurrency(currency)) throw new AppError('UNSUPPORTED_CURRENCY', 400, `Unsupported currency: ${currency}`);
    let rate = '1';
    let fxSource: 'same' | 'market' | 'manual' = 'same';
    if (currency !== group.currency) {
      if (input.fxRate) {
        rate = input.fxRate;
        fxSource = 'manual';
      } else {
        rate = (await this.fx.rateFor(currency, group.currency)).rate;
        fxSource = 'market';
      }
    }
    const converted = convert(input.amount, currency, group.currency, rate);
    if (converted < 1) throw new AppError('VALIDATION_FAILED', 400, 'Amount is too small to convert', { fields: { amount: ['Too small'] } });

    const outstanding = await this.pairOutstanding(me.groupId, input.fromMemberId, input.toMemberId);
    const baseAmount = fitToOutstanding(converted, outstanding);
    if (baseAmount === null) {
      throw new AppError('VALIDATION_FAILED', 400, 'More than is owed', { fields: { amount: ['More than is owed'] }, outstanding });
    }

    const status = asCreditor ? 'confirmed' : 'pending';
    const names = new Map(members.map((m) => [m.id, m.displayName]));
    const created = await this.prisma.transaction(async (tx) => {
      const s = await tx.settlement.create({
        data: {
          groupId: me.groupId,
          fromMemberId: input.fromMemberId,
          toMemberId: input.toMemberId,
          amount: input.amount,
          currency,
          fxRate: new Prisma.Decimal(rate),
          fxSource,
          baseAmount,
          method: input.method ?? null,
          status,
          createdById: me.id,
          confirmedAt: status === 'confirmed' ? new Date() : null,
        },
      });
      await this.activity(tx, s, group.currency, names, me.id, status === 'confirmed' ? 'payment.confirmed' : 'payment.claimed');
      return s;
    });
    if (status === 'confirmed') await this.stopSettledReminders(created);
    return this.view(created);
  }

  async confirm(me: GroupMember, id: string) {
    const s = await this.load(me.groupId, id);
    if (s.toMemberId !== me.id) throw new AppError('FORBIDDEN', 403, 'Only the receiver can confirm a payment');
    if (s.status !== 'pending') throw new AppError('SETTLEMENT_NOT_PENDING', 409);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId }, select: { currency: true } });
    // Balances may have moved since the claim was made; re-fit against what is owed now
    const outstanding = await this.pairOutstanding(me.groupId, s.fromMemberId, s.toMemberId);
    const baseAmount = fitToOutstanding(s.baseAmount, outstanding);
    if (baseAmount === null) {
      throw new AppError('VALIDATION_FAILED', 400, 'More than is owed now', { fields: { amount: ['More than is owed'] }, outstanding });
    }
    const names = await this.names(s);
    const confirmed = await this.prisma.transaction(async (tx) => {
      const claimed = await tx.settlement.updateMany({ where: { id: s.id, status: 'pending' }, data: { status: 'confirmed', confirmedAt: new Date(), baseAmount } });
      if (claimed.count === 0) throw new AppError('SETTLEMENT_NOT_PENDING', 409);
      const after = await tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
      await this.activity(tx, after, group.currency, names, me.id, 'payment.confirmed');
      return after;
    });
    await this.stopSettledReminders(confirmed);
    return this.view(confirmed);
  }

  async reject(me: GroupMember, id: string) {
    const s = await this.load(me.groupId, id);
    if (s.toMemberId !== me.id) throw new AppError('FORBIDDEN', 403, 'Only the receiver can reject a payment');
    if (s.status !== 'pending') throw new AppError('SETTLEMENT_NOT_PENDING', 409);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId }, select: { currency: true } });
    const names = await this.names(s);
    const rejected = await this.prisma.transaction(async (tx) => {
      const claimed = await tx.settlement.updateMany({ where: { id: s.id, status: 'pending' }, data: { status: 'rejected' } });
      if (claimed.count === 0) throw new AppError('SETTLEMENT_NOT_PENDING', 409);
      const after = await tx.settlement.findUniqueOrThrow({ where: { id: s.id } });
      await this.activity(tx, after, group.currency, names, me.id, 'payment.rejected');
      return after;
    });
    return this.view(rejected);
  }

  /** Undo: the creator can delete within 24h. The row is gone but the activity feed records it. */
  async undo(me: GroupMember, id: string) {
    const s = await this.load(me.groupId, id);
    if (s.createdById !== me.id) throw new AppError('FORBIDDEN', 403, 'Only the person who recorded a payment can undo it');
    if (Date.now() - s.createdAt.getTime() > UNDO_WINDOW_MS) throw new AppError('FORBIDDEN', 403, 'Payments can only be undone within 24 hours');
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId }, select: { currency: true } });
    const names = await this.names(s);
    await this.prisma.transaction(async (tx) => {
      const gone = await tx.settlement.deleteMany({ where: { id: s.id } });
      if (gone.count === 0) throw new AppError('NOT_FOUND', 404);
      await this.activity(tx, s, group.currency, names, me.id, 'payment.undone');
    });
  }

  // ---- internals ----------------------------------------------------------

  /** What `from` still owes `to`, from the current simplified transfers. 0 when they are not a transfer pair. */
  async pairOutstanding(groupId: string, fromMemberId: string, toMemberId: string): Promise<number> {
    const transfers = await this.balances.transfers(groupId);
    return transfers.find((t) => t.fromMemberId === fromMemberId && t.toMemberId === toMemberId)?.amount ?? 0;
  }

  /** Auto-repeat reminders for a pair stop once the pair has nothing left to settle (design §9.8). */
  private async stopSettledReminders(s: Settlement) {
    if ((await this.pairOutstanding(s.groupId, s.fromMemberId, s.toMemberId)) > 0) return;
    await this.prisma.reminder.updateMany({
      where: { groupId: s.groupId, fromMemberId: s.toMemberId, toMemberId: s.fromMemberId, stoppedAt: null, nextRunAt: { not: null } },
      data: { stoppedAt: new Date(), nextRunAt: null },
    });
  }

  private async load(groupId: string, id: string) {
    // groupId comes from the guard-verified member, so another group's settlement is "not found"
    const s = await this.prisma.settlement.findFirst({ where: { id, groupId } });
    if (!s) throw new AppError('NOT_FOUND', 404);
    return s;
  }

  private async names(s: Settlement) {
    const rows = await this.prisma.member.findMany({ where: { id: { in: [s.fromMemberId, s.toMemberId] } }, select: { id: true, displayName: true } });
    return new Map(rows.map((m) => [m.id, m.displayName]));
  }

  private activity(
    tx: Prisma.TransactionClient,
    s: Settlement,
    groupCurrency: string,
    names: Map<string, string>,
    actorId: string,
    event: 'payment.confirmed' | 'payment.claimed' | 'payment.rejected' | 'payment.undone',
  ) {
    return tx.activity.create({
      data: {
        groupId: s.groupId,
        actorMemberId: actorId,
        type: 'payment',
        event,
        payload: {
          settlementId: s.id,
          fromMemberId: s.fromMemberId,
          toMemberId: s.toMemberId,
          fromName: names.get(s.fromMemberId) ?? '',
          toName: names.get(s.toMemberId) ?? '',
          amount: s.amount,
          currency: s.currency,
          baseAmount: s.baseAmount,
          groupCurrency,
          method: s.method,
          date: day(new Date()),
        },
      },
    });
  }
}

const paymentFields = (d: { bitPhone: string | null; payboxPhone: string | null; paypalMe: string | null; revolutTag: string | null; bankDetails: string | null }) => ({
  bitPhone: d.bitPhone,
  payboxPhone: d.payboxPhone,
  paypalMe: d.paypalMe,
  revolutTag: d.revolutTag,
  bankDetails: d.bankDetails,
});
