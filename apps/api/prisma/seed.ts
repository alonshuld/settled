import { PrismaClient } from '@prisma/client';
import { computeShares, generateInviteCode } from '@settled/core';

const prisma = new PrismaClient();
const COLORS = ['#2f6f5e', '#c2410c', '#6d5bd0', '#b45309', '#0e7490'];

type Seed = { description: string; category: 'food' | 'stay' | 'transport' | 'fuel' | 'activities' | 'shopping' | 'other'; amount: number; payer: string; date: string };

async function makeGroup(opts: {
  name: string;
  type: 'trip' | 'home' | 'meal' | 'gift';
  startDate?: string;
  endDate?: string;
  me: string;
  members: string[];
  expenses: Seed[];
  settlements?: { from: string; to: string; amount: number }[];
}) {
  const group = await prisma.group.create({
    data: {
      name: opts.name,
      type: opts.type,
      currency: 'ILS',
      startDate: opts.startDate ? new Date(opts.startDate) : null,
      endDate: opts.endDate ? new Date(opts.endDate) : null,
      createdById: opts.me,
      invite: { create: { code: generateInviteCode() } },
    },
  });
  const ids: Record<string, string> = {};
  for (const [i, name] of opts.members.entries()) {
    const m = await prisma.member.create({
      data: {
        groupId: group.id,
        displayName: name,
        color: COLORS[i % COLORS.length]!,
        sortOrder: i,
        role: i === 0 ? 'owner' : 'member',
        userId: i === 0 ? opts.me : null,
        joinedAt: i === 0 ? new Date() : null,
      },
    });
    ids[name] = m.id;
  }
  const members = opts.members.map((n, order) => ({ id: ids[n]!, order }));
  for (const e of opts.expenses) {
    const shares = computeShares({ amount: e.amount, baseAmount: e.amount, payerId: ids[e.payer]!, members, mode: 'equal' });
    await prisma.expense.create({
      data: {
        groupId: group.id,
        description: e.description,
        category: e.category,
        amount: e.amount,
        currency: 'ILS',
        fxRate: 1,
        fxSource: 'same',
        baseAmount: e.amount,
        paidByMemberId: ids[e.payer]!,
        date: new Date(e.date),
        splitMode: 'equal',
        createdById: ids[e.payer]!,
        shares: { create: shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) },
      },
    });
  }
  for (const s of opts.settlements ?? []) {
    await prisma.settlement.create({
      data: {
        groupId: group.id,
        fromMemberId: ids[s.from]!,
        toMemberId: ids[s.to]!,
        amount: s.amount,
        currency: 'ILS',
        fxRate: 1,
        fxSource: 'same',
        baseAmount: s.amount,
        status: 'confirmed',
        confirmedAt: new Date(),
        createdById: ids[s.from]!,
      },
    });
  }
}

async function main() {
  await prisma.group.deleteMany();
  await prisma.user.deleteMany({ where: { id: 'seed-alon' } });
  const alon = await prisma.user.create({
    data: { id: 'seed-alon', name: 'Alon', email: 'alon@example.com', emailVerified: true, locale: 'en' },
  });

  // Amounts are agorot (handoff §10)
  await makeGroup({
    name: 'Crete trip',
    type: 'trip',
    startDate: '2026-10-12',
    endDate: '2026-10-18',
    me: alon.id,
    members: ['Alon', 'Noa', 'Itay', 'Maya'],
    expenses: [
      { description: 'Hotel in Chania', category: 'stay', amount: 480000, payer: 'Alon', date: '2026-10-12' },
      { description: 'Car rental', category: 'transport', amount: 160000, payer: 'Noa', date: '2026-10-12' },
      { description: 'Gas', category: 'fuel', amount: 64000, payer: 'Maya', date: '2026-10-14' },
      { description: 'Taverna dinner', category: 'food', amount: 112000, payer: 'Itay', date: '2026-10-15' },
      { description: 'Groceries', category: 'food', amount: 48000, payer: 'Itay', date: '2026-10-16' },
      { description: 'Boat tour to Balos', category: 'activities', amount: 136000, payer: 'Maya', date: '2026-10-17' },
    ],
    settlements: [{ from: 'Maya', to: 'Alon', amount: 50000 }],
  });

  // You owe Roni ₪340: Roni paid 680 split 2 ways
  await makeGroup({
    name: 'The flat', type: 'home', me: alon.id, members: ['Alon', 'Roni'],
    expenses: [{ description: 'Internet + utilities', category: 'other', amount: 68000, payer: 'Roni', date: '2026-10-01' }],
  });
  // You are owed ₪120: Alon paid 360 split 3 ways
  await makeGroup({
    name: 'Friday dinners', type: 'meal', me: alon.id, members: ['Alon', 'Dana', 'Gal'],
    expenses: [{ description: 'Sushi', category: 'food', amount: 36000, payer: 'Alon', date: '2026-10-16' }],
  });
  // Settled: gift paid by Alon, Dana paid back her half
  await makeGroup({
    name: 'Gift for Dana', type: 'gift', me: alon.id, members: ['Alon', 'Gal'],
    expenses: [{ description: 'Gift', category: 'shopping', amount: 20000, payer: 'Alon', date: '2026-10-10' }],
    settlements: [{ from: 'Gal', to: 'Alon', amount: 10000 }],
  });
}

main().finally(() => prisma.$disconnect());
