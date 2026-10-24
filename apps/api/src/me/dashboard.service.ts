import { Injectable } from '@nestjs/common';
import { convert, simplifyDebts } from '@settled/core';
import { ActivityService } from '../activity/activity.service';
import { FxService } from '../fx/fx.service';
import { BalancesService, netOf } from '../groups/balances.service';
import { GroupsService } from '../groups/groups.service';
import { PrismaService } from '../prisma/prisma.service';

const ATTENTION_LIMIT = 5;
const RECENT_ACTIVITY = 5;

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
    private readonly fx: FxService,
    private readonly activity: ActivityService,
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

    // Other currencies are converted at the latest market rate, so the overall figure is approximate
    // (design §4.2). A currency with no rate at all is left out and listed in `excludedCurrencies`.
    let owedToMe = 0;
    let iOwe = 0;
    let approximate = false;
    const excluded: string[] = [];
    for (const t of totalRows) {
      if (!t.owedToMe && !t.iOwe) continue;
      if (t.currency === defaultCurrency) {
        owedToMe += t.owedToMe;
        iOwe += t.iOwe;
        continue;
      }
      try {
        const { rate } = await this.fx.rateFor(t.currency, defaultCurrency);
        owedToMe += convert(t.owedToMe, t.currency, defaultCurrency, rate);
        iOwe += convert(t.iOwe, t.currency, defaultCurrency, rate);
        approximate = true;
      } catch {
        excluded.push(t.currency);
      }
    }

    return {
      totals: totalRows,
      overall: { currency: defaultCurrency, net: owedToMe - iOwe, owedToMe, iOwe, approximate, excludedCurrencies: excluded },
      groups: cards,
      needsAttention: attention.sort((a, b) => b.amount - a.amount).slice(0, ATTENTION_LIMIT),
      recentActivity: (await this.activity.feed(userId, { limit: RECENT_ACTIVITY })).items,
    };
  }
}
