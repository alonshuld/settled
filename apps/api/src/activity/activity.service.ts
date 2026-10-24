import { Injectable } from '@nestjs/common';
import type { ActivityType, Prisma } from '@prisma/client';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

export interface FeedQuery {
  type?: Extract<ActivityType, 'expense' | 'payment' | 'reminder' | 'member'>;
  groupId?: string;
  cursor?: string;
  limit: number;
}

/** `/activity` (design §9.10). Rows are written by the services that change data; this only reads and tracks "unread". */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async feed(userId: string, q: FeedQuery) {
    const base = await this.visible(userId, q.groupId);
    const where: Prisma.ActivityWhereInput = { AND: [base, ...(q.type ? [{ type: q.type }] : [])] };
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      (where.AND as Prisma.ActivityWhereInput[]).push({
        OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }],
      });
    }
    const [rows, user] = await Promise.all([
      this.prisma.activity.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        include: { group: { select: { name: true } } },
      }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { activityReadAt: true } }),
    ]);
    const page = rows.slice(0, q.limit);
    const actorIds = [...new Set(page.map((a) => a.actorMemberId).filter((x): x is string => x !== null))];
    const actors = new Map(
      (await this.prisma.member.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, color: true, userId: true } })).map((m) => [m.id, m]),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((a) => {
        const actor = a.actorMemberId ? actors.get(a.actorMemberId) : undefined;
        return {
          id: a.id,
          groupId: a.groupId,
          groupName: a.group.name,
          type: a.type,
          event: a.event,
          actor: actor ? { memberId: actor.id, name: actor.displayName, color: actor.color } : null,
          payload: a.payload,
          createdAt: a.createdAt,
          // Your own actions are never "new" to you
          unread: actor?.userId !== userId && (!user.activityReadAt || a.createdAt > user.activityReadAt),
        };
      }),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async counts(userId: string, groupId?: string) {
    const base = await this.visible(userId, groupId);
    const mine = await this.prisma.member.findMany({ where: { userId }, select: { id: true } });
    const [user, byType] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { activityReadAt: true } }),
      this.prisma.activity.groupBy({ by: ['type'], where: base, _count: { _all: true } }),
    ]);
    const unread = await this.prisma.activity.count({
      where: {
        AND: [
          base,
          ...(user.activityReadAt ? [{ createdAt: { gt: user.activityReadAt } }] : []),
          { OR: [{ actorMemberId: null }, { actorMemberId: { notIn: mine.map((m) => m.id) } }] },
        ],
      },
    });
    const n = (t: ActivityType) => byType.find((r) => r.type === t)?._count._all ?? 0;
    return {
      all: byType.reduce((sum, r) => sum + r._count._all, 0),
      expense: n('expense'),
      payment: n('payment'),
      reminder: n('reminder'),
      member: n('member'),
      unread,
    };
  }

  /** Moves the read watermark forward; it never moves back, so a stale client cannot make read items unread. */
  async markRead(userId: string, upTo?: Date) {
    const at = !upTo || upTo > new Date() ? new Date() : upTo;
    await this.prisma.user.updateMany({
      where: { id: userId, OR: [{ activityReadAt: null }, { activityReadAt: { lt: at } }] },
      data: { activityReadAt: at },
    });
  }

  /** Group-wide items of the caller's active groups, plus items addressed to the caller (design §9.10). */
  private async visible(userId: string, groupId?: string): Promise<Prisma.ActivityWhereInput> {
    const memberships = await this.prisma.member.findMany({ where: { userId, leftAt: null }, select: { groupId: true } });
    const groupIds = memberships.map((m) => m.groupId);
    return {
      OR: [{ groupId: { in: groupIds }, audienceUserId: null }, { audienceUserId: userId }],
      ...(groupId ? { groupId } : {}),
    };
  }
}

function encodeCursor(a: { createdAt: Date; id: string }) {
  return Buffer.from(`${a.createdAt.toISOString()}|${a.id}`).toString('base64url');
}

function decodeCursor(cursor: string) {
  const [c, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = c ? new Date(c) : null;
  if (!createdAt || !id || Number.isNaN(createdAt.getTime())) {
    throw new AppError('VALIDATION_FAILED', 400, 'Invalid cursor', { fields: { cursor: ['Invalid cursor'] } });
  }
  return { createdAt, id };
}
