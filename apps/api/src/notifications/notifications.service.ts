import { Injectable, Logger } from '@nestjs/common';
import type { Activity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { renderNotification } from './messages';
import { PushService } from './push.service';

const COLLAPSE_MS = 5 * 60 * 1000;

type Payload = Record<string, any>;
interface Recipient {
  userId: string;
  /** Skips the user's preference: their money changed, or they must act (design §9.5.1). */
  always: boolean;
  pref?: 'newExpenses' | 'paymentsReceived' | 'remindersToMe';
}

/**
 * Push fan-out for activity rows (design §9.5.1, §10). Called after the transaction that wrote the rows has committed,
 * so a crash in between loses a notification, never data. It never throws: a failed push must not fail the request.
 * Reminder emails are sent by the reminder flow itself, so the activity fan-out is push only.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async dispatch(activityIds: string[]): Promise<void> {
    if (activityIds.length === 0) return;
    try {
      const rows = await this.prisma.activity.findMany({ where: { id: { in: activityIds } }, include: { group: { select: { name: true } } } });
      for (const a of rows) await this.dispatchOne(a, a.group.name);
    } catch (e) {
      this.log.error(`notification fan-out failed: ${(e as Error).message}`);
    }
  }

  private async dispatchOne(a: Activity, groupName: string) {
    if (a.event === 'expense.updated' && (await this.collapsed(a))) return;
    const recipients = await this.recipients(a);
    if (recipients.length === 0) return;

    const [users, prefs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: recipients.map((r) => r.userId) }, deletedAt: null }, select: { id: true, locale: true } }),
      this.prisma.notificationPrefs.findMany({ where: { userId: { in: recipients.map((r) => r.userId) } } }),
    ]);
    const prefOf = new Map(prefs.map((p) => [p.userId, p]));
    for (const u of users) {
      const r = recipients.find((x) => x.userId === u.id)!;
      // No row means defaults, which are all on except weeklySummary
      if (!r.always && r.pref && prefOf.get(u.id)?.[r.pref] === false) continue;
      const text = renderNotification(a.event, a.payload as Payload, u.locale, groupName);
      if (!text) continue;
      try {
        await this.push.send(u.id, { ...text, url: `/groups/${a.groupId}` });
      } catch (e) {
        this.log.warn(`push to user failed: ${(e as Error).message}`);
      }
    }
  }

  /** Repeat edits of one expense by one person within 5 minutes make a single notification; every activity row is kept. */
  private async collapsed(a: Activity): Promise<boolean> {
    const p = a.payload as Payload;
    const earlier = await this.prisma.activity.findFirst({
      where: {
        groupId: a.groupId,
        event: 'expense.updated',
        actorMemberId: a.actorMemberId,
        payload: { path: ['expenseId'], equals: p.expenseId },
        createdAt: { gte: new Date(a.createdAt.getTime() - COLLAPSE_MS), lt: a.createdAt },
      },
      select: { id: true },
    });
    return earlier !== null;
  }

  private async recipients(a: Activity): Promise<Recipient[]> {
    const p = a.payload as Payload;
    const members = await this.prisma.member.findMany({
      where: { groupId: a.groupId, leftAt: null, userId: { not: null } },
      select: { id: true, userId: true },
    });
    const userOf = (memberId?: string) => members.find((m) => m.id === memberId)?.userId ?? null;
    const out: Recipient[] = [];
    const add = (userId: string | null, always: boolean, pref?: Recipient['pref']) => {
      if (userId) out.push({ userId, always, pref });
    };

    switch (a.event) {
      case 'expense.created':
      case 'expense.updated':
      case 'expense.deleted': {
        const affected = new Set<string>(p.affectedMemberIds ?? []);
        for (const m of members) {
          if (m.id === a.actorMemberId) continue;
          add(m.userId, affected.has(m.id), 'newExpenses');
        }
        break;
      }
      case 'payment.claimed':
        add(userOf(p.toMemberId), false, 'paymentsReceived');
        break;
      case 'payment.confirmed':
        if (p.toMemberId !== a.actorMemberId) add(userOf(p.toMemberId), false, 'paymentsReceived');
        if (p.fromMemberId !== a.actorMemberId) add(userOf(p.fromMemberId), true);
        break;
      case 'payment.rejected':
        if (p.fromMemberId !== a.actorMemberId) add(userOf(p.fromMemberId), true);
        break;
      case 'reminder.received':
        // Email reminders arrive by email; only the push channel is a push
        if (p.channel === 'push') add(a.audienceUserId, false, 'remindersToMe');
        break;
      case 'reminder.nudge':
        add(a.audienceUserId, true);
        break;
    }
    return out;
  }
}
