import { Injectable } from '@nestjs/common';
import { simplifyDebts } from '@settled/core';
import { BalancesService, netOf } from '../groups/balances.service';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';

const ATTENTION_LIMIT = 5;

interface Total {
  currency: string;
  net: number;
  owedToMe: number;
  iOwe: number;
  owedByPeople: number;
  owedInGroups: number;
  oweToPeople: number;
  oweInGroups: number;
}

/** `GET /me/dashboard` (design §9.1). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
    private readonly balances: BalancesService,
  ) {}

  async get(userId: string, defaultCurrency: string) {
    const groups = await this.prisma.group.findMany({
      where: { members: { some: { userId, leftAt: null } } },
      include: { members: { select: { id: true, userId: true, leftAt: true, displayName: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const balances = await this.balances.forGroups(groups.map((g) => g.id));
    const cards = await this.groups.cards(userId, groups);

    const totals = new Map<string, Total & { owedBy: Set<string>; oweTo: Set<string> }>();
    const attention: {
      kind: 'iOwe' | 'owedToMe';
      groupId: string;
      groupName: string;
      currency: string;
      memberId: string;
      name: string;
      amount: number;
    }[] = [];

    for (const g of groups) {
      const me = g.members.find((m) => m.userId === userId && !m.leftAt);
      const b = balances.get(g.id)!;
      if (!me) continue;
      const t =
        totals.get(g.currency) ??
        {
          currency: g.currency, net: 0, owedToMe: 0, iOwe: 0, owedByPeople: 0, owedInGroups: 0, oweToPeople: 0, oweInGroups: 0,
          owedBy: new Set<string>(), oweTo: new Set<string>(),
        };
      totals.set(g.currency, t);

      const net = netOf(b, me.id);
      t.net += net;
      if (net > 0) {
        t.owedToMe += net;
        t.owedInGroups += 1;
      } else if (net < 0) {
        t.iOwe += -net;
        t.oweInGroups += 1;
      }

      // Who actually pays whom, after simplification, so "needs attention" matches the settle-up view
      for (const tr of simplifyDebts(b.balances)) {
        const incoming = tr.toMemberId === me.id;
        if (!incoming && tr.fromMemberId !== me.id) continue;
        const otherId = incoming ? tr.fromMemberId : tr.toMemberId;
        (incoming ? t.owedBy : t.oweTo).add(`${g.id}:${otherId}`);
        attention.push({
          kind: incoming ? 'owedToMe' : 'iOwe',
          groupId: g.id,
          groupName: g.name,
          currency: g.currency,
          memberId: otherId,
          name: g.members.find((m) => m.id === otherId)?.displayName ?? '',
          amount: tr.amount,
        });
      }
    }

    const totalRows = [...totals.values()].map(({ owedBy, oweTo, ...t }) => ({
      ...t,
      // distinct people, not distinct (group, person) pairs
      owedByPeople: new Set([...owedBy].map((k) => k.split(':')[1])).size,
      oweToPeople: new Set([...oweTo].map((k) => k.split(':')[1])).size,
    }));

    // Cross-currency conversion needs the FX module (step 4). Until then `overall` only covers
    // groups already in the user's default currency and says which currencies it left out.
    const own = totalRows.find((t) => t.currency === defaultCurrency);
    const skipped = totalRows.filter((t) => t.currency !== defaultCurrency && (t.owedToMe || t.iOwe)).map((t) => t.currency);

    return {
      totals: totalRows,
      overall: {
        currency: defaultCurrency,
        net: own?.net ?? 0,
        owedToMe: own?.owedToMe ?? 0,
        iOwe: own?.iOwe ?? 0,
        approximate: false,
        excludedCurrencies: skipped,
      },
      groups: cards,
      needsAttention: attention.sort((a, b) => b.amount - a.amount).slice(0, ATTENTION_LIMIT),
      recentActivity: [], // /activity lands in step 6
    };
  }
}
