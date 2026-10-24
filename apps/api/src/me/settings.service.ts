import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface PaymentDetailsInput {
  bitPhone: string | null;
  payboxPhone: string | null;
  paypalMe: string | null;
  revolutTag: string | null;
  bankDetails: string | null;
}

export interface NotificationPrefsInput {
  remindersToMe?: boolean;
  newExpenses?: boolean;
  paymentsReceived?: boolean;
  weeklySummary?: boolean;
}

export interface PushSubscriptionInput {
  kind: 'webpush' | 'expo';
  endpoint: string;
  keys?: { p256dh: string; auth: string };
}

export const DEFAULT_PREFS = { remindersToMe: true, newExpenses: true, paymentsReceived: true, weeklySummary: false };
const EMPTY_DETAILS: PaymentDetailsInput = { bitPhone: null, payboxPhone: null, paypalMe: null, revolutTag: null, bankDetails: null };

/** Payment details, notification preferences, push subscriptions and stats (design §9.1). */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- payment details ----------------------------------------------------

  async getPaymentDetails(userId: string): Promise<PaymentDetailsInput> {
    const row = await this.prisma.paymentDetails.findUnique({ where: { userId } });
    return row ? pick(row) : EMPTY_DETAILS;
  }

  /** Replaces the whole record: a field left out is cleared. */
  async putPaymentDetails(userId: string, input: PaymentDetailsInput): Promise<PaymentDetailsInput> {
    const row = await this.prisma.paymentDetails.upsert({ where: { userId }, create: { userId, ...input }, update: input });
    return pick(row);
  }

  // ---- notification preferences -------------------------------------------

  async getPrefs(userId: string) {
    const row = await this.prisma.notificationPrefs.findUnique({ where: { userId } });
    return row
      ? { remindersToMe: row.remindersToMe, newExpenses: row.newExpenses, paymentsReceived: row.paymentsReceived, weeklySummary: row.weeklySummary }
      : DEFAULT_PREFS;
  }

  async patchPrefs(userId: string, input: NotificationPrefsInput) {
    await this.prisma.notificationPrefs.upsert({ where: { userId }, create: { userId, ...input }, update: input });
    return this.getPrefs(userId);
  }

  // ---- push subscriptions -------------------------------------------------

  /** The endpoint is unique: re-subscribing from the same device (or after another account used it) moves it to this user. */
  async addPush(userId: string, input: PushSubscriptionInput) {
    const keys = input.keys ?? Prisma.DbNull;
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { userId, kind: input.kind, endpoint: input.endpoint, keys },
      update: { userId, kind: input.kind, keys },
    });
    return { id: row.id };
  }

  async removePush(userId: string, id: string) {
    const { count } = await this.prisma.pushSubscription.deleteMany({ where: { id, userId } });
    if (count === 0) throw new AppError('NOT_FOUND', 404);
  }

  // ---- stats --------------------------------------------------------------

  /**
   * `GET /me/stats` (design §9.1) for one calendar month (UTC), per group currency:
   * what the user's share of that month's expenses came to, and what people paid back to them.
   * `remindersSent` counts reminders they sent themselves (not auto-repeats) that did not fail.
   */
  async stats(userId: string, month: string) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const mine = (await this.prisma.member.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);

    const [shares, paidBack, remindersSent] = await Promise.all([
      this.prisma.expenseShare.findMany({
        where: { memberId: { in: mine }, expense: { deletedAt: null, date: { gte: from, lt: to } } },
        select: { amount: true, expense: { select: { group: { select: { currency: true } } } } },
      }),
      this.prisma.settlement.findMany({
        where: { toMemberId: { in: mine }, status: 'confirmed', confirmedAt: { gte: from, lt: to } },
        select: { baseAmount: true, group: { select: { currency: true } } },
      }),
      this.prisma.reminder.count({
        where: { fromMemberId: { in: mine }, parentId: null, status: { not: 'failed' }, createdAt: { gte: from, lt: to } },
      }),
    ]);

    const byCurrency = new Map<string, { currency: string; myShareOfExpenses: number; paidBackToMe: number }>();
    const row = (currency: string) => {
      const r = byCurrency.get(currency) ?? { currency, myShareOfExpenses: 0, paidBackToMe: 0 };
      byCurrency.set(currency, r);
      return r;
    };
    for (const s of shares) row(s.expense.group.currency).myShareOfExpenses += s.amount;
    for (const s of paidBack) row(s.group.currency).paidBackToMe += s.baseAmount;
    return { month, perCurrency: [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency)), remindersSent };
  }
}

const pick = (d: PaymentDetailsInput): PaymentDetailsInput => ({
  bitPhone: d.bitPhone,
  payboxPhone: d.payboxPhone,
  paypalMe: d.paypalMe,
  revolutTag: d.revolutTag,
  bankDetails: d.bankDetails,
});
