import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Gender, type GroupType, type Member } from '@prisma/client';
import { formatInviteCode, generateInviteCode } from '@settled/core';
import type { GroupMember } from '../common/decorators';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService, netOf } from './balances.service';
import { colorFor } from './palette';

export interface NewMember {
  displayName: string;
  email?: string;
  phone?: string;
}

export interface CreateGroup {
  name: string;
  type: GroupType;
  currency: string;
  startDate?: string;
  endDate?: string;
  members: NewMember[];
}

export interface UpdateGroup {
  name?: string;
  type?: GroupType;
  currency?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateMember {
  displayName?: string;
  gender?: Gender | null;
  email?: string | null;
  phone?: string | null;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : s);

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balances: BalancesService,
    private readonly config: ConfigService,
  ) {}

  // ---- serialisers ---------------------------------------------------------

  member(m: Member, viewerUserId?: string) {
    const placeholder = m.userId === null;
    return {
      id: m.id,
      displayName: m.displayName,
      color: m.color,
      role: m.role,
      gender: m.gender,
      isPlaceholder: placeholder,
      isMe: viewerUserId !== undefined && m.userId === viewerUserId,
      // Contact details are only kept for people who haven't joined yet
      email: placeholder ? m.inviteEmail : null,
      phone: placeholder ? m.invitePhone : null,
      joinedAt: m.joinedAt,
      leftAt: m.leftAt,
    };
  }

  inviteView(invite: { code: string; expiresAt: Date | null }) {
    const code = formatInviteCode(invite.code);
    return { code, url: `${this.config.getOrThrow<string>('APP_URL')}/j/${code}`, expiresAt: invite.expiresAt };
  }

  // ---- groups --------------------------------------------------------------

  async list(userId: string, status: 'active' | 'closed') {
    const groups = await this.prisma.group.findMany({
      where: {
        closedAt: status === 'closed' ? { not: null } : null,
        members: { some: { userId, leftAt: null } },
      },
      include: { members: { select: { id: true, userId: true, leftAt: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return this.cards(userId, groups);
  }

  /** Group cards: the shape shared by `GET /groups` and the dashboard. */
  async cards(
    userId: string,
    groups: (Prisma.GroupGetPayload<object> & { members: { id: string; userId: string | null; leftAt: Date | null }[] })[],
  ) {
    const balances = await this.balances.forGroups(groups.map((g) => g.id));
    return groups.map((g) => {
      const me = g.members.find((m) => m.userId === userId && !m.leftAt);
      const b = balances.get(g.id)!;
      return {
        id: g.id,
        name: g.name,
        type: g.type,
        currency: g.currency,
        startDate: day(g.startDate),
        endDate: day(g.endDate),
        memberCount: g.members.filter((m) => !m.leftAt).length,
        myNet: me ? netOf(b, me.id) : 0,
        settled: b.balances.every((x) => x.net === 0),
        closedAt: g.closedAt,
      };
    });
  }

  async create(userId: string, userName: string, input: CreateGroup) {
    this.checkDates(input.startDate, input.endDate);
    const groupId = await this.prisma.transaction(async (tx) => {
      const group = await tx.group.create({
        data: {
          name: input.name,
          type: input.type,
          currency: input.currency,
          startDate: toDate(input.startDate) ?? null,
          endDate: toDate(input.endDate) ?? null,
          createdById: userId,
          invite: { create: { code: await this.freshCode(tx) } },
        },
      });
      const creator = await tx.member.create({
        data: {
          groupId: group.id,
          userId,
          displayName: userName,
          color: colorFor(0),
          role: 'owner',
          sortOrder: 0,
          joinedAt: new Date(),
        },
      });
      for (const [i, m] of input.members.entries()) {
        await tx.member.create({
          data: {
            groupId: group.id,
            displayName: m.displayName,
            inviteEmail: m.email,
            invitePhone: m.phone,
            color: colorFor(i + 1),
            sortOrder: i + 1,
          },
        });
      }
      await tx.activity.create({
        data: {
          groupId: group.id,
          actorMemberId: creator.id,
          type: 'group',
          event: 'group.created',
          payload: { name: group.name, currency: group.currency },
        },
      });
      return group.id;
    });
    return this.detail(groupId, userId);
  }

  async detail(groupId: string, userId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({
      where: { id: groupId },
      include: { members: { orderBy: { sortOrder: 'asc' } }, invite: true },
    });
    const b = await this.balances.forGroup(groupId);
    const me = group.members.find((m) => m.userId === userId && !m.leftAt);
    const mine = b.balances.find((x) => x.memberId === me?.id);
    return {
      id: group.id,
      name: group.name,
      type: group.type,
      currency: group.currency,
      startDate: day(group.startDate),
      endDate: day(group.endDate),
      closedAt: group.closedAt,
      createdAt: group.createdAt,
      members: group.members.map((m) => this.member(m, userId)),
      invite: group.invite && !group.invite.revokedAt ? this.inviteView(group.invite) : null,
      stats: {
        totalSpent: b.totalSpent,
        myShare: mine?.share ?? 0,
        iPaid: mine?.paid ?? 0,
        myNet: mine?.net ?? 0,
      },
      expenseCount: b.expenseCount,
    };
  }

  async update(me: GroupMember, input: UpdateGroup) {
    this.requireOwner(me);
    const group = await this.openGroup(me.groupId);
    if (input.currency !== undefined && input.currency !== group.currency) {
      const expenses = await this.prisma.expense.count({ where: { groupId: group.id } });
      if (expenses > 0) throw new AppError('CURRENCY_LOCKED', 409, 'Base currency is fixed after the first expense');
    }
    const start = input.startDate === undefined ? day(group.startDate) : input.startDate;
    const end = input.endDate === undefined ? day(group.endDate) : input.endDate;
    this.checkDates(start ?? undefined, end ?? undefined);
    await this.prisma.group.update({
      where: { id: group.id },
      data: {
        name: input.name,
        type: input.type,
        currency: input.currency,
        startDate: toDate(input.startDate),
        endDate: toDate(input.endDate),
      },
    });
    return this.detail(group.id, me.userId);
  }

  async setClosed(me: GroupMember, closed: boolean) {
    this.requireOwner(me);
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: me.groupId } });
    if (closed && group.closedAt) throw new AppError('GROUP_CLOSED', 409, 'Group is already closed');
    await this.prisma.transaction(async (tx) => {
      await tx.group.update({ where: { id: group.id }, data: { closedAt: closed ? new Date() : null } });
      await tx.activity.create({
        data: {
          groupId: group.id,
          actorMemberId: me.id,
          type: 'group',
          event: closed ? 'group.closed' : 'group.reopened',
          payload: { name: group.name },
        },
      });
    });
    return this.detail(group.id, me.userId);
  }

  async remove(me: GroupMember) {
    this.requireOwner(me);
    const expenses = await this.prisma.expense.count({ where: { groupId: me.groupId } });
    if (expenses > 0) throw new AppError('GROUP_HAS_EXPENSES', 409, 'Only groups without expenses can be deleted');
    await this.prisma.group.delete({ where: { id: me.groupId } });
  }

  // ---- members -------------------------------------------------------------

  async addPlaceholder(me: GroupMember, input: NewMember) {
    await this.openGroup(me.groupId);
    const created = await this.prisma.transaction(async (tx) => {
      const last = await tx.member.aggregate({ where: { groupId: me.groupId }, _max: { sortOrder: true } });
      const sortOrder = (last._max.sortOrder ?? -1) + 1;
      const m = await tx.member.create({
        data: {
          groupId: me.groupId,
          displayName: input.displayName,
          inviteEmail: input.email,
          invitePhone: input.phone,
          color: colorFor(sortOrder),
          sortOrder,
        },
      });
      await tx.activity.create({
        data: {
          groupId: me.groupId,
          actorMemberId: me.id,
          type: 'member',
          event: 'member.added',
          payload: { memberId: m.id, name: m.displayName },
        },
      });
      return m;
    });
    return this.member(created, me.userId);
  }

  async updateMember(me: GroupMember, memberId: string, input: UpdateMember) {
    const target = await this.targetMember(me.groupId, memberId);
    // Self, or anyone for placeholders (design §9.3)
    if (target.id !== me.id && target.userId !== null) throw new AppError('FORBIDDEN', 403);
    const updated = await this.prisma.member.update({
      where: { id: target.id },
      data: {
        displayName: input.displayName,
        gender: input.gender,
        inviteEmail: input.email,
        invitePhone: input.phone,
      },
    });
    return this.member(updated, me.userId);
  }

  async removePlaceholder(me: GroupMember, memberId: string) {
    const target = await this.targetMember(me.groupId, memberId);
    if (target.userId !== null) throw new AppError('FORBIDDEN', 403, 'Only people who have not joined can be removed');
    const [paid, shares, settlements] = await Promise.all([
      this.prisma.expense.count({ where: { paidByMemberId: target.id } }),
      this.prisma.expenseShare.count({ where: { memberId: target.id } }),
      this.prisma.settlement.count({ where: { OR: [{ fromMemberId: target.id }, { toMemberId: target.id }] } }),
    ]);
    if (paid + shares + settlements > 0) {
      throw new AppError('MEMBER_HAS_ACTIVITY', 409, 'This person already has expenses or payments');
    }
    await this.prisma.member.delete({ where: { id: target.id } });
  }

  async leave(me: GroupMember) {
    // The design has no ownership transfer yet, so an owner can't walk away from the group.
    if (me.role === 'owner') throw new AppError('FORBIDDEN', 403, 'The owner cannot leave the group');
    const b = await this.balances.forGroup(me.groupId);
    const net = netOf(b, me.id);
    if (net !== 0) throw new AppError('LEAVE_WITH_OPEN_BALANCE', 409, 'Settle up before leaving', { net });
    await this.prisma.transaction(async (tx) => {
      await tx.member.update({ where: { id: me.id }, data: { leftAt: new Date() } });
      await tx.activity.create({
        data: { groupId: me.groupId, actorMemberId: me.id, type: 'member', event: 'member.left', payload: {} },
      });
    });
  }

  // ---- helpers -------------------------------------------------------------

  requireOwner(me: GroupMember) {
    if (me.role !== 'owner') throw new AppError('FORBIDDEN', 403, 'Only the group owner can do this');
  }

  /** Loads the group and rejects writes when it is closed. */
  async openGroup(groupId: string) {
    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.closedAt) throw new AppError('GROUP_CLOSED', 409);
    return group;
  }

  private async targetMember(groupId: string, memberId: string) {
    const m = await this.prisma.member.findFirst({ where: { id: memberId, groupId, leftAt: null } });
    if (!m) throw new AppError('NOT_FOUND', 404);
    return m;
  }

  private checkDates(start?: string, end?: string) {
    if (start && end && end < start) {
      throw new AppError('VALIDATION_FAILED', 400, 'End date is before start date', {
        fields: { endDate: ['End date is before start date'] },
      });
    }
  }

  /** A code nobody uses yet. 32^6 codes make a retry vanishingly rare. */
  async freshCode(db: Pick<Prisma.TransactionClient, 'invite'>): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = generateInviteCode();
      if (!(await db.invite.findUnique({ where: { code } }))) return code;
    }
    throw new AppError('INTERNAL', 500, 'Could not allocate an invite code');
  }
}
