import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Reminder, type ReminderChannel, type ReminderTone } from '@prisma/client';
import { appendPaymentDetails, renderReminder, smsLink, whatsappLink } from '@settled/core';
import type { GroupMember } from '../common/decorators';
import { AppError } from '../common/errors';
import { emailEnabled, type Env } from '../config/env';
import { EmailService } from '../email/email.service';
import { BalancesService } from '../groups/balances.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SendReminder {
  toMemberId: string;
  tone: ReminderTone;
  channel: ReminderChannel;
  /** The composer's (possibly edited) text. Omitted = the server renders the tone template. */
  message?: string;
  autoRepeat: boolean;
}

export interface SendAll {
  tone: ReminderTone;
  channel: ReminderChannel;
  autoRepeat: boolean;
}

export interface HistoryQuery {
  toMemberId?: string;
  cursor?: string;
  limit: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAIR_COOLDOWN_MS = 12 * 60 * 60 * 1000;
export const AUTO_REPEAT_DAYS = 3;
const MAX_DUE_PER_TICK = 20;
const EMAIL_ATTEMPTS = 3;

type Group = Awaited<ReturnType<RemindersService['loadGroup']>>;
type GroupMemberRow = Group['members'][number];

/** Everything needed to write one reminder and the rows that go with it. */
interface Prepared {
  reminder: Prisma.ReminderUncheckedCreateInput;
  activities: Prisma.ActivityCreateManyInput[];
  /** WhatsApp / SMS deep link for the client (or for the creditor's nudge). */
  link: string | null;
  email: { to: string; subject: string; text: string } | null;
  /** Filled by `commit`, so the push fan-out can run after the transaction. */
  activityIds?: string[];
}

const addDays = (d: Date, days: number) => new Date(d.getTime() + days * DAY_MS);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class RemindersService {
  private readonly log = new Logger(RemindersService.name);
  private readonly emailOn: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: BalancesService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
    config: ConfigService<Env, true>,
  ) {
    this.emailOn = emailEnabled({ NODE_ENV: config.get('NODE_ENV', { infer: true }), RESEND_API_KEY: config.get('RESEND_API_KEY', { infer: true }) });
  }

  view(r: Reminder, link?: string | null) {
    const out = {
      id: r.id,
      groupId: r.groupId,
      fromMemberId: r.fromMemberId,
      toMemberId: r.toMemberId,
      amount: r.amount,
      tone: r.tone,
      channel: r.channel,
      message: r.message,
      locale: r.locale,
      status: r.status,
      error: r.error,
      autoRepeatDays: r.autoRepeatDays,
      nextRunAt: r.nextRunAt,
      stoppedAt: r.stoppedAt,
      parentId: r.parentId,
      sentAt: r.sentAt,
      createdAt: r.createdAt,
    };
    if (link === undefined) return out;
    // `waUrl` is the name the design uses for the WhatsApp case
    return { ...out, link, ...(r.channel === 'whatsapp' ? { waUrl: link } : {}) };
  }

  // ---- reads --------------------------------------------------------------

  async history(me: GroupMember, q: HistoryQuery) {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    const where: Prisma.ReminderWhereInput = {
      groupId: me.groupId,
      OR: [{ fromMemberId: me.id }, { toMemberId: me.id }],
      ...(q.toMemberId ? { toMemberId: q.toMemberId } : {}),
    };
    const rows = await this.prisma.reminder.findMany({
      where: cursor
        ? { AND: [where, { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }] }
        : where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return { items: page.map((r) => this.view(r)), nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null };
  }

  // ---- writes -------------------------------------------------------------

  async create(me: GroupMember, input: SendReminder) {
    const group = await this.openGroup(me.groupId);
    const transfers = await this.balances.transfers(me.groupId);
    const owed = transfers.find((t) => t.toMemberId === me.id && t.fromMemberId === input.toMemberId);
    if (!owed) {
      throw new AppError('VALIDATION_FAILED', 400, 'This person does not owe you anything right now', {
        fields: { toMemberId: ['Does not owe you'] },
      });
    }
    return this.sendTo(me, group, owed.amount, input);
  }

  /** "Remind everyone": one reminder per person who currently owes the caller. */
  async createAll(me: GroupMember, input: SendAll) {
    const group = await this.openGroup(me.groupId);
    const owedToMe = (await this.balances.transfers(me.groupId)).filter((t) => t.toMemberId === me.id);
    const created: ReturnType<RemindersService['view']>[] = [];
    const skipped: { memberId: string; reason: string }[] = [];
    for (const t of owedToMe) {
      try {
        created.push(await this.sendTo(me, group, t.amount, { ...input, toMemberId: t.fromMemberId }));
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        skipped.push({ memberId: t.fromMemberId, reason: e.code });
      }
    }
    return { created, skipped };
  }

  /** Stops auto-repeat for the whole chain (the original and its children). */
  async stop(me: GroupMember, id: string) {
    const r = await this.prisma.reminder.findFirst({ where: { id, groupId: me.groupId, fromMemberId: me.id } });
    if (!r) throw new AppError('NOT_FOUND', 404);
    const rootId = r.parentId ?? r.id;
    await this.prisma.reminder.updateMany({
      where: { OR: [{ id: rootId }, { parentId: rootId }], stoppedAt: null },
      data: { stoppedAt: new Date(), nextRunAt: null },
    });
    return this.view(await this.prisma.reminder.findUniqueOrThrow({ where: { id: rootId } }));
  }

  // ---- auto-repeat (called by the cron task) --------------------------------

  /**
   * Sends every due auto-repeat reminder. Rows are locked with SKIP LOCKED so overlapping cron ticks
   * cannot send the same one twice (design §10).
   */
  async runDue(now = new Date()): Promise<{ sent: number; stopped: number }> {
    let sent = 0;
    let stopped = 0;
    const after: (() => Promise<void>)[] = [];
    const transfersOf = new Map<string, Awaited<ReturnType<BalancesService['transfers']>>>();

    await this.prisma.transaction(async (tx) => {
      const due = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Reminder"
        WHERE "nextRunAt" <= ${now} AND "stoppedAt" IS NULL
        ORDER BY "nextRunAt"
        LIMIT ${MAX_DUE_PER_TICK}
        FOR UPDATE SKIP LOCKED`;
      const rows = await tx.reminder.findMany({ where: { id: { in: due.map((d) => d.id) } }, orderBy: { nextRunAt: 'asc' } });
      const stop = (id: string) => tx.reminder.update({ where: { id }, data: { stoppedAt: now, nextRunAt: null } });

      for (const r of rows) {
        const group = await this.loadGroup(tx, r.groupId);
        let transfers = transfersOf.get(r.groupId);
        if (!transfers) {
          transfers = await this.balances.transfers(r.groupId);
          transfersOf.set(r.groupId, transfers);
        }
        const owed = transfers.find((t) => t.toMemberId === r.fromMemberId && t.fromMemberId === r.toMemberId);
        const creditor = group.members.find((m) => m.id === r.fromMemberId && m.leftAt === null);
        if (group.closedAt || !owed || !creditor) {
          await stop(r.id);
          stopped++;
          continue;
        }
        const prepared = await this.prepare(tx, group, creditor, owed.amount, {
          toMemberId: r.toMemberId,
          tone: r.tone,
          channel: r.channel,
          autoRepeat: false,
          parentId: r.id,
        });
        if (!prepared) {
          // The person lost the channel since (e.g. left the app): nothing to send, stop nagging
          await stop(r.id);
          stopped++;
          continue;
        }
        const child = await this.commit(tx, prepared);
        await tx.reminder.update({ where: { id: r.id }, data: { nextRunAt: addDays(now, r.autoRepeatDays ?? AUTO_REPEAT_DAYS) } });
        after.push(async () => void (await this.afterCommit(prepared, child)));
        sent++;
      }
    });
    for (const run of after) await run();
    return { sent, stopped };
  }

  // ---- internals ----------------------------------------------------------

  private async sendTo(me: GroupMember, group: Group, outstanding: number, input: SendReminder) {
    const creditor = group.members.find((m) => m.id === me.id && m.leftAt === null);
    if (!creditor) throw new AppError('NOT_A_MEMBER', 403);

    const recent = await this.prisma.reminder.findFirst({
      where: {
        groupId: me.groupId,
        fromMemberId: me.id,
        toMemberId: input.toMemberId,
        parentId: null,
        status: { not: 'failed' },
        createdAt: { gt: new Date(Date.now() - PAIR_COOLDOWN_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (recent) {
      const retryAfterSeconds = Math.ceil((recent.createdAt.getTime() + PAIR_COOLDOWN_MS - Date.now()) / 1000);
      throw new AppError('RATE_LIMITED', 429, 'You already reminded this person recently', { retryAfterSeconds });
    }

    const prepared = await this.prepare(this.prisma, group, creditor, outstanding, input);
    if (!prepared) {
      const debtor = group.members.find((m) => m.id === input.toMemberId);
      throw new AppError('REMINDER_CHANNEL_UNAVAILABLE', 422, 'This person cannot be reached that way', {
        alternatives: debtor ? availableChannels(debtor, this.emailOn) : [],
      });
    }
    const created = await this.prisma.transaction((tx) => this.commit(tx, prepared));
    const final = await this.afterCommit(prepared, created);
    return this.view(final, prepared.link ?? undefined);
  }

  private async openGroup(groupId: string) {
    const group = await this.loadGroup(this.prisma, groupId);
    if (group.closedAt) throw new AppError('GROUP_CLOSED', 409);
    return group;
  }

  loadGroup(db: Prisma.TransactionClient | PrismaService, groupId: string) {
    return db.group.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        id: true,
        name: true,
        currency: true,
        closedAt: true,
        members: {
          select: {
            id: true,
            displayName: true,
            gender: true,
            role: true,
            leftAt: true,
            userId: true,
            inviteEmail: true,
            invitePhone: true,
            user: { select: { id: true, email: true, isAnonymous: true, locale: true, gender: true, contactPhone: true, deletedAt: true } },
          },
        },
      },
    });
  }

  /**
   * Resolves recipient, channel and text. Returns null when the channel is not available for the recipient.
   * Reads only; `commit` writes.
   */
  private async prepare(
    db: Prisma.TransactionClient | PrismaService,
    group: Group,
    creditor: GroupMemberRow,
    outstanding: number,
    input: SendReminder & { parentId?: string },
  ): Promise<Prepared | null> {
    const debtor = group.members.find((m) => m.id === input.toMemberId && m.leftAt === null);
    if (!debtor) throw new AppError('VALIDATION_FAILED', 400, 'Not an active member', { fields: { toMemberId: ['Not an active member'] } });
    if (debtor.id === creditor.id) throw new AppError('VALIDATION_FAILED', 400, 'Cannot remind yourself', { fields: { toMemberId: ['Not allowed'] } });
    if (!availableChannels(debtor, this.emailOn).includes(input.channel)) return null;

    const owner = group.members.find((m) => m.role === 'owner');
    const locale = debtor.user?.locale ?? owner?.user?.locale ?? 'he';
    const gender = debtor.gender ?? debtor.user?.gender ?? null;
    const details = creditor.userId ? await db.paymentDetails.findUnique({ where: { userId: creditor.userId } }) : null;
    const base =
      input.message?.trim() ||
      renderReminder({
        tone: input.tone,
        locale,
        gender,
        debtorName: debtor.displayName,
        creditorName: creditor.displayName,
        amount: outstanding,
        currency: group.currency,
        groupName: group.name,
      });
    const message = appendPaymentDetails(base, details, locale);
    const email = debtor.user?.email && !debtor.user.isAnonymous ? debtor.user.email : debtor.inviteEmail;
    const phone = debtor.user?.contactPhone ?? debtor.invitePhone;

    let link: string | null = null;
    if (input.channel === 'whatsapp' && phone) link = whatsappLink(phone, message);
    if (input.channel === 'sms' && phone) link = smsLink(phone, message);
    const handedOff = input.channel === 'whatsapp' || input.channel === 'sms';

    const now = new Date();
    const activities: Prisma.ActivityCreateManyInput[] = [];
    const ref = {
      groupId: group.id,
      fromMemberId: creditor.id,
      toMemberId: debtor.id,
      amount: outstanding,
      currency: group.currency,
    };

    if (input.parentId && handedOff) {
      // The server cannot send WhatsApp/SMS: nudge the creditor to send the next one themselves
      if (creditor.userId) {
        activities.push({
          groupId: group.id,
          actorMemberId: debtor.id,
          type: 'reminder',
          event: 'reminder.nudge',
          audienceUserId: creditor.userId,
          payload: { ...ref, debtorName: debtor.displayName, channel: input.channel, link, message },
        });
      }
    } else {
      activities.push({
        groupId: group.id,
        actorMemberId: creditor.id,
        type: 'reminder',
        event: 'reminder.sent',
        audienceUserId: creditor.userId,
        payload: { ...ref, debtorName: debtor.displayName, channel: input.channel, tone: input.tone, autoRepeat: input.autoRepeat },
      });
      if (!handedOff && debtor.userId) {
        activities.push({
          groupId: group.id,
          actorMemberId: creditor.id,
          type: 'reminder',
          event: 'reminder.received',
          audienceUserId: debtor.userId,
          payload: { ...ref, creditorName: creditor.displayName, groupName: group.name, tone: input.tone, channel: input.channel, message },
        });
      }
    }

    return {
      reminder: {
        groupId: group.id,
        fromMemberId: creditor.id,
        toMemberId: debtor.id,
        amount: outstanding,
        tone: input.tone,
        channel: input.channel,
        message,
        locale,
        // push is "delivered" once the in-app item exists; email is sent after commit; the rest are handed to the client
        status: input.channel === 'email' ? 'queued' : handedOff ? 'handed_off' : 'sent',
        sentAt: input.channel === 'email' ? null : now,
        autoRepeatDays: input.autoRepeat ? AUTO_REPEAT_DAYS : null,
        nextRunAt: input.autoRepeat ? addDays(now, AUTO_REPEAT_DAYS) : null,
        parentId: input.parentId ?? null,
      },
      activities,
      link,
      email:
        input.channel === 'email' && email
          ? {
              to: email,
              subject: locale === 'he' ? `תזכורת תשלום · ${group.name}` : `Payment reminder · ${group.name}`,
              text: message,
            }
          : null,
    };
  }

  private async commit(tx: Prisma.TransactionClient, p: Prepared) {
    const created = await tx.reminder.create({ data: p.reminder });
    p.activityIds = [];
    for (const data of p.activities) p.activityIds.push((await tx.activity.create({ data, select: { id: true } })).id);
    return created;
  }

  /** Email goes out after the commit (design §10): a crash loses a notification, never data. */
  private async afterCommit(p: Prepared, reminder: Reminder): Promise<Reminder> {
    await this.notifications.dispatch(p.activityIds ?? []);
    if (!p.email) return reminder;
    let lastError = '';
    for (let attempt = 1; attempt <= EMAIL_ATTEMPTS; attempt++) {
      try {
        await this.email.send(p.email);
        return this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'sent', sentAt: new Date(), error: null } });
      } catch (e) {
        lastError = (e as Error).message;
        this.log.warn(`reminder ${reminder.id} email attempt ${attempt} failed: ${lastError}`);
        if (attempt < EMAIL_ATTEMPTS) await wait(300 * attempt ** 2);
      }
    }
    return this.prisma.reminder.update({ where: { id: reminder.id }, data: { status: 'failed', error: lastError.slice(0, 200) } });
  }
}

/** Channels that work for this recipient right now (design §9.9). `emailOn` is false in production without Resend. */
export function availableChannels(m: GroupMemberRow, emailOn = true): ReminderChannel[] {
  const out: ReminderChannel[] = [];
  if (m.user && !m.user.deletedAt) out.push('push');
  if (emailOn && ((m.user?.email && !m.user.isAnonymous) || m.inviteEmail)) out.push('email');
  if (m.user?.contactPhone || m.invitePhone) out.push('whatsapp', 'sms');
  return out;
}

function encodeCursor(r: Reminder) {
  return Buffer.from(`${r.createdAt.toISOString()}|${r.id}`).toString('base64url');
}

function decodeCursor(cursor: string) {
  const [c, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = c ? new Date(c) : null;
  if (!createdAt || !id || Number.isNaN(createdAt.getTime())) {
    throw new AppError('VALIDATION_FAILED', 400, 'Invalid cursor', { fields: { cursor: ['Invalid cursor'] } });
  }
  return { createdAt, id };
}
