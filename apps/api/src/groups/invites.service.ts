import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parseInviteCode } from '@settled/core';
import type { GroupMember } from '../common/decorators';
import { AppError } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { BalancesService } from './balances.service';
import { GroupsService } from './groups.service';
import { colorFor } from './palette';

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
    private readonly balances: BalancesService,
  ) {}

  async get(me: GroupMember) {
    const invite = await this.prisma.invite.findUniqueOrThrow({ where: { groupId: me.groupId } });
    return this.groups.inviteView(invite);
  }

  async rotate(me: GroupMember) {
    this.groups.requireOwner(me);
    await this.groups.openGroup(me.groupId);
    const invite = await this.prisma.transaction(async (tx) =>
      tx.invite.update({
        where: { groupId: me.groupId },
        data: { code: await this.groups.freshCode(tx), revokedAt: null },
      }),
    );
    return this.groups.inviteView(invite);
  }

  async preview(rawCode: string) {
    const invite = await this.resolve(rawCode);
    const group = await this.prisma.group.findUniqueOrThrow({
      where: { id: invite.groupId },
      include: { members: { where: { leftAt: null }, orderBy: { sortOrder: 'asc' } } },
    });
    const { expenseCount, totalSpent } = await this.balances.forGroup(group.id);
    const owner = group.members.find((m) => m.role === 'owner');
    return {
      group: {
        name: group.name,
        type: group.type,
        startDate: group.startDate?.toISOString().slice(0, 10) ?? null,
        endDate: group.endDate?.toISOString().slice(0, 10) ?? null,
        memberCount: group.members.length,
        expenseCount,
        totalSpent,
        currency: group.currency,
      },
      invitedBy: owner ? { name: owner.displayName, color: owner.color } : null,
      claimable: group.members
        .filter((m) => m.userId === null)
        .map((m) => ({ memberId: m.id, displayName: m.displayName, color: m.color })),
    };
  }

  async join(userId: string, userName: string, rawCode: string, claimMemberId?: string) {
    const invite = await this.resolve(rawCode);
    const groupId = invite.groupId;

    const existing = await this.prisma.member.findFirst({ where: { groupId, userId, leftAt: null } });
    if (existing) return { groupId, memberId: existing.id };

    const group = await this.prisma.group.findUniqueOrThrow({ where: { id: groupId } });
    if (group.closedAt) throw new AppError('GROUP_CLOSED', 409);

    try {
      const memberId = await this.prisma.transaction(async (tx) => {
        const rejoin = await tx.member.findUnique({ where: { groupId_userId: { groupId, userId } } });
        let id: string;
        if (claimMemberId) {
          // Atomic claim: only one caller can turn a placeholder into themselves.
          const claimed = await tx.member.updateMany({
            where: { id: claimMemberId, groupId, userId: null, leftAt: null },
            data: { userId, joinedAt: new Date() },
          });
          if (claimed.count === 0) throw new AppError('MEMBER_ALREADY_CLAIMED', 409);
          id = claimMemberId;
        } else if (rejoin) {
          // Left earlier: come back as the same person, history intact
          await tx.member.update({ where: { id: rejoin.id }, data: { leftAt: null } });
          id = rejoin.id;
        } else {
          const last = await tx.member.aggregate({ where: { groupId }, _max: { sortOrder: true } });
          const sortOrder = (last._max.sortOrder ?? -1) + 1;
          id = (
            await tx.member.create({
              data: { groupId, userId, displayName: userName, color: colorFor(sortOrder), sortOrder, joinedAt: new Date() },
            })
          ).id;
        }
        await tx.activity.create({
          data: { groupId, actorMemberId: id, type: 'member', event: 'member.joined', payload: { name: userName } },
        });
        return id;
      });
      return { groupId, memberId };
    } catch (e) {
      // Two joins from the same user raced: the unique (groupId, userId) wins, the loser gets the winner's row
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const m = await this.prisma.member.findFirstOrThrow({ where: { groupId, userId } });
        return { groupId, memberId: m.id };
      }
      throw e;
    }
  }

  private async resolve(rawCode: string) {
    const code = parseInviteCode(rawCode);
    const invite = code ? await this.prisma.invite.findUnique({ where: { code } }) : null;
    if (!invite) throw new AppError('INVITE_NOT_FOUND', 404);
    if (invite.revokedAt || (invite.expiresAt && invite.expiresAt < new Date())) throw new AppError('INVITE_EXPIRED', 410);
    return invite;
  }
}
