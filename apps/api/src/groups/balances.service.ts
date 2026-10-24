import { Injectable } from '@nestjs/common';
import { computeBalances, simplifyDebts, type MemberBalance } from '@settled/core';
import { PrismaService } from '../prisma/prisma.service';

export interface GroupBalances {
  groupId: string;
  balances: MemberBalance[];
  /** Live (non-deleted) expense count and base-currency total. */
  expenseCount: number;
  totalSpent: number;
}

/** Balances come from the same core functions the web app uses (design §3). */
@Injectable()
export class BalancesService {
  constructor(private readonly prisma: PrismaService) {}

  async forGroups(groupIds: string[]): Promise<Map<string, GroupBalances>> {
    if (groupIds.length === 0) return new Map();
    const [members, expenses, shares, settlements] = await Promise.all([
      this.prisma.member.findMany({ where: { groupId: { in: groupIds } }, select: { id: true, groupId: true } }),
      this.prisma.expense.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        select: { id: true, groupId: true, paidByMemberId: true, baseAmount: true },
      }),
      this.prisma.expenseShare.findMany({
        where: { expense: { groupId: { in: groupIds }, deletedAt: null } },
        select: { expenseId: true, memberId: true, amount: true },
      }),
      this.prisma.settlement.findMany({
        where: { groupId: { in: groupIds }, status: 'confirmed' },
        select: { groupId: true, fromMemberId: true, toMemberId: true, baseAmount: true },
      }),
    ]);

    const expenseGroup = new Map(expenses.map((e) => [e.id, e.groupId]));
    const out = new Map<string, GroupBalances>();
    for (const groupId of groupIds) {
      const groupExpenses = expenses.filter((e) => e.groupId === groupId);
      out.set(groupId, {
        groupId,
        balances: computeBalances(
          members.filter((m) => m.groupId === groupId).map((m) => m.id),
          groupExpenses,
          shares.filter((s) => expenseGroup.get(s.expenseId) === groupId),
          settlements.filter((s) => s.groupId === groupId),
        ),
        expenseCount: groupExpenses.length,
        totalSpent: groupExpenses.reduce((sum, e) => sum + e.baseAmount, 0),
      });
    }
    return out;
  }

  /** `GET /groups/:id/balances` (design §9.7): balances, simplified transfers and the category breakdown. */
  async detail(groupId: string, currency: string) {
    const [b, byCategory] = await Promise.all([
      this.forGroup(groupId),
      this.prisma.expense.groupBy({
        by: ['category'],
        where: { groupId, deletedAt: null },
        _sum: { baseAmount: true },
      }),
    ]);
    return {
      currency,
      totalSpent: b.totalSpent,
      members: b.balances,
      transfers: simplifyDebts(b.balances),
      byCategory: byCategory
        .map((c) => ({ category: c.category, amount: c._sum.baseAmount ?? 0 }))
        .sort((x, y) => y.amount - x.amount),
      expenseCount: b.expenseCount,
    };
  }

  async forGroup(groupId: string): Promise<GroupBalances> {
    return (await this.forGroups([groupId])).get(groupId)!;
  }
}

export const netOf = (g: GroupBalances | undefined, memberId: string) =>
  g?.balances.find((b) => b.memberId === memberId)?.net ?? 0;
