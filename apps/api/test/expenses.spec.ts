import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { FxFeed } from '../src/fx/fx-feed';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const ORIGIN = 'http://localhost:3000';
const run = Math.random().toString(36).slice(2, 8);
const D1 = '2001-02-03';
const D2 = '2001-02-04';
const TODAY = new Date().toISOString().slice(0, 10);

/** Fixed rates: 1 EUR = 3.9821 ILS, 1 USD = 1.99105 ILS. Answers with the date it was asked for. */
const fakeFeed = {
  calls: [] as string[],
  async fetchDay(date: string) {
    this.calls.push(date);
    return {
      date: date === 'latest' ? TODAY : date,
      source: 'fawazahmed0' as const,
      perUsd: { ILS: '1.99105', EUR: '0.5', USD: '1', JPY: '150', KWD: '0.3' },
    };
  },
};

describe('expenses', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(FxFeed).useValue(fakeFeed).compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.exchangeRate.deleteMany({ where: { source: 'fawazahmed0', date: { in: [new Date(D1), new Date(D2), new Date(TODAY)] } } });
  });

  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.exchangeRate.deleteMany({ where: { date: { in: [new Date(D1), new Date(D2), new Date(TODAY)] } } });
    await prisma.expense.deleteMany({ where: { group: { name: { startsWith: `t-${run}` } } } });
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  async function guest(name: string) {
    const res = await request(http()).post('/api/auth/sign-in/anonymous').set('Origin', ORIGIN).send({}).expect(200);
    const token = res.headers['set-auth-token'] as string;
    userIds.push(res.body.user.id);
    await request(http()).patch('/api/v1/me').set('Authorization', `Bearer ${token}`).send({ name }).expect(200);
    const api = (m: 'get' | 'post' | 'patch' | 'delete', path: string) =>
      request(http())[m](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return { api, userId: res.body.user.id as string };
  }
  type Client = Awaited<ReturnType<typeof guest>>;

  /** Alon (owner) + Noa + Roni placeholders. */
  async function setup(extra: Record<string, unknown> = {}) {
    const alon = await guest('Alon');
    const g = (await alon.api('post', '/groups').send({ name: `t-${run} trip`, type: 'trip', currency: 'ILS', members: [{ displayName: 'Noa' }, { displayName: 'Roni' }], ...extra }).expect(201)).body;
    const [a, n, r] = g.members.map((m: { id: string }) => m.id) as string[];
    return { alon, g, groupId: g.id as string, a: a!, n: n!, r: r! };
  }

  const dinner = (s: { a: string; n: string; r: string }, over: Record<string, unknown> = {}) => ({
    amount: 30001,
    description: 'Dinner',
    category: 'food',
    paidByMemberId: s.a,
    date: D1,
    split: { mode: 'equal', included: [s.a, s.n, s.r] },
    ...over,
  });

  it('creates an expense in the group currency and splits it with the remainder to the payer', async () => {
    const s = await setup();
    const res = await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(201);
    expect(res.body).toMatchObject({ amount: 30001, currency: 'ILS', fxRate: '1', fxSource: 'same', fxDate: null, baseAmount: 30001, version: 1, splitMode: 'equal' });
    const byMember = Object.fromEntries(res.body.shares.map((x: { memberId: string; amount: number }) => [x.memberId, x.amount]));
    expect(byMember).toEqual({ [s.a]: 10001, [s.n]: 10000, [s.r]: 10000 });

    const bal = (await s.alon.api('get', `/groups/${s.groupId}/balances`).expect(200)).body;
    expect(bal).toMatchObject({ currency: 'ILS', totalSpent: 30001, expenseCount: 1, byCategory: [{ category: 'food', amount: 30001 }] });
    expect(bal.members.find((m: { memberId: string }) => m.memberId === s.a)).toMatchObject({ paid: 30001, share: 10001, net: 20000 });
    expect(bal.transfers).toEqual(expect.arrayContaining([{ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }]));
    expect(bal.transfers).toHaveLength(2);

    const act = await prisma.activity.findFirstOrThrow({ where: { groupId: s.groupId, event: 'expense.created' } });
    expect(act.payload).toMatchObject({ expenseId: res.body.id, actor: 'Alon', paidBy: 'Alon' });
  });

  it('converts a foreign-currency expense at the market rate and locks it', async () => {
    const s = await setup();
    const res = await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 4000, currency: 'EUR' })).expect(201);
    expect(res.body).toMatchObject({ currency: 'EUR', fxRate: '3.9821', fxSource: 'market', fxDate: D1, baseAmount: 15928 });
    // payer is in the split, so the leftover agora goes to them: 5310 / 5309 / 5309
    expect(res.body.shares.map((x: { amount: number }) => x.amount).sort()).toEqual([5309, 5309, 5310]);
    expect(res.body.shares.find((x: { memberId: string }) => x.memberId === s.a).amount).toBe(5310);

    // the rate is cached: a second expense on the same day does not call the feed again
    const calls = fakeFeed.calls.length;
    await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 1000, currency: 'EUR' })).expect(201);
    expect(fakeFeed.calls.length).toBe(calls);
  });

  it('uses a manual rate and keeps it when the amount is edited', async () => {
    const s = await setup();
    const created = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 10000, currency: 'EUR', fxRate: '4' })).expect(201)).body;
    expect(created).toMatchObject({ fxRate: '4', fxSource: 'manual', baseAmount: 40000 });
    const edited = (await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 1, amount: 20000 }).expect(200)).body;
    expect(edited).toMatchObject({ fxRate: '4', fxSource: 'manual', baseAmount: 80000, version: 2 });
    // switching back to the market rate
    const market = (await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 2, fxRate: null }).expect(200)).body;
    expect(market).toMatchObject({ fxRate: '3.9821', fxSource: 'market' });
  });

  it('handles 0- and 3-decimal currencies', async () => {
    const s = await setup();
    // ¥1000 at 1.99105/150 ILS per yen = ₪13.2737 → 1327 agorot
    const yen = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 1000, currency: 'JPY' })).expect(201)).body;
    expect(yen.baseAmount).toBe(1327);
    expect(yen.shares.reduce((a: number, x: { amount: number }) => a + x.amount, 0)).toBe(1327);
    // 1.000 KWD (1000 fils) at 1.99105/0.3 = 6.6368 ILS → 664 agorot
    const kwd = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 1000, currency: 'KWD' })).expect(201)).body;
    expect(kwd.baseAmount).toBe(664);
  });

  it('validates splits, members and currencies', async () => {
    const s = await setup();
    const post = (body: unknown) => s.alon.api('post', `/groups/${s.groupId}/expenses`).send(body as object);

    const mismatch = await post(dinner(s, { amount: 10000, split: { mode: 'exact', amounts: { [s.a]: 6000, [s.n]: 3000 } } })).expect(400);
    expect(mismatch.body.error).toMatchObject({ code: 'SPLIT_SUM_MISMATCH', details: { expected: 10000, actual: 9000 } });

    const exact = (await post(dinner(s, { amount: 10000, split: { mode: 'exact', amounts: { [s.a]: 7000, [s.n]: 3000 } } })).expect(201)).body;
    expect(exact.shares).toEqual(expect.arrayContaining([{ memberId: s.a, amount: 7000, originalAmount: 7000, shares: null }]));

    const weighted = (await post(dinner(s, { amount: 9000, split: { mode: 'shares', shares: { [s.a]: 1, [s.n]: 2 } } })).expect(201)).body;
    expect(weighted.shares.find((x: { memberId: string }) => x.memberId === s.n)).toMatchObject({ amount: 6000, shares: 2 });

    expect((await post(dinner(s, { paidByMemberId: 'nope' })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(dinner(s, { split: { mode: 'equal', included: ['nope'] } })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(dinner(s, { currency: 'XXX' })).expect(400)).body.error.code).toBe('UNSUPPORTED_CURRENCY');
    expect((await post(dinner(s, { amount: -5 })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(dinner(s, { amount: 100_000_001 })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(dinner(s, { fxRate: '0' })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
    expect((await post(dinner(s, { split: { mode: 'equal', included: [] } })).expect(400)).body.error.code).toBe('VALIDATION_FAILED');
  });

  it('replays a repeated Idempotency-Key instead of creating a duplicate', async () => {
    const s = await setup();
    const key = crypto.randomUUID();
    const send = () => s.alon.api('post', `/groups/${s.groupId}/expenses`).set('Idempotency-Key', key).send(dinner(s));
    const [first, second] = await Promise.all([send(), send()]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    const third = await send();
    expect(third.body.id).toBe(first.body.id);
    expect(await prisma.expense.count({ where: { groupId: s.groupId } })).toBe(1);
    // a different request body under the same key on another route is refused
    await s.alon.api('post', '/groups').set('Idempotency-Key', key).send({ name: `t-${run} x`, type: 'trip', currency: 'ILS' }).expect(400);
  });

  it('lists newest first with cursor pagination and filters', async () => {
    const s = await setup();
    for (const [i, date] of ['2001-02-01', '2001-02-03', '2001-02-02'].entries()) {
      await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { description: `e${i}`, date, category: i === 1 ? 'fuel' : 'food', paidByMemberId: i === 2 ? s.n : s.a })).expect(201);
    }
    const page1 = (await s.alon.api('get', `/groups/${s.groupId}/expenses?limit=2`).expect(200)).body;
    expect(page1.items.map((e: { description: string }) => e.description)).toEqual(['e1', 'e2']);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await s.alon.api('get', `/groups/${s.groupId}/expenses?limit=2&cursor=${page1.nextCursor}`).expect(200)).body;
    expect(page2.items.map((e: { description: string }) => e.description)).toEqual(['e0']);
    expect(page2.nextCursor).toBeNull();

    const fuel = (await s.alon.api('get', `/groups/${s.groupId}/expenses?category=fuel`).expect(200)).body;
    expect(fuel.items).toHaveLength(1);
    expect((await s.alon.api('get', `/groups/${s.groupId}/expenses?memberId=${s.n}`).expect(200)).body.items).toHaveLength(3); // in every split
    await s.alon.api('get', `/groups/${s.groupId}/expenses?cursor=garbage`).expect(400);
  });

  it('edits with a diff, notifies the affected members, and rejects stale versions', async () => {
    const s = await setup();
    const created = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 48000, split: { mode: 'equal', included: [s.a, s.n] } })).expect(201)).body;
    const patch = (body: object) => s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send(body);

    const edited = (await patch({ version: 1, amount: 52000, paidByMemberId: s.n }).expect(200)).body;
    expect(edited).toMatchObject({ amount: 52000, baseAmount: 52000, paidByMemberId: s.n, version: 2 });

    const act = await prisma.activity.findFirstOrThrow({ where: { groupId: s.groupId, event: 'expense.updated' } });
    const p = act.payload as any;
    expect(p.actor).toBe('Alon');
    expect(p.diff.amount).toEqual([48000, 52000]);
    expect(p.diff.paidBy).toEqual(['Alon', 'Noa']);
    expect(p.netChanges).toEqual(expect.arrayContaining([{ memberId: s.a, name: 'Alon', before: 24000, after: -26000 }]));
    expect(p.affectedMemberIds).toEqual(expect.arrayContaining([s.a, s.n]));

    const stale = await patch({ version: 1, description: 'late' }).expect(409);
    expect(stale.body.error).toMatchObject({ code: 'VERSION_CONFLICT', details: { currentVersion: 2 } });

    // an edit that changes nothing writes no activity and keeps the version
    const same = (await patch({ version: 2, description: 'Dinner' }).expect(200)).body;
    expect(same.version).toBe(3);
    expect(await prisma.activity.count({ where: { groupId: s.groupId, event: 'expense.updated' } })).toBe(1);
  });

  it('re-resolves the market rate when the date or currency changes', async () => {
    const s = await setup();
    const created = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { amount: 4000, currency: 'EUR' })).expect(201)).body;
    const moved = (await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 1, date: D2 }).expect(200)).body;
    expect(moved).toMatchObject({ date: D2, fxDate: D2, fxSource: 'market' });
    const toUsd = (await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 2, currency: 'USD' }).expect(200)).body;
    expect(toUsd).toMatchObject({ currency: 'USD', fxRate: '1.99105', baseAmount: 7964 });
    const home = (await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 3, currency: 'ILS' }).expect(200)).body;
    expect(home).toMatchObject({ currency: 'ILS', fxRate: '1', fxSource: 'same', fxDate: null, baseAmount: 4000 });
  });

  it('soft-deletes, drops out of balances and logs who deleted it', async () => {
    const s = await setup();
    const created = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(201)).body;
    await s.alon.api('delete', `/groups/${s.groupId}/expenses/${created.id}`).expect(204);
    await s.alon.api('get', `/groups/${s.groupId}/expenses/${created.id}`).expect(404);
    await s.alon.api('delete', `/groups/${s.groupId}/expenses/${created.id}`).expect(404);
    expect((await s.alon.api('get', `/groups/${s.groupId}/balances`).expect(200)).body).toMatchObject({ totalSpent: 0, expenseCount: 0, transfers: [] });
    const act = await prisma.activity.findFirstOrThrow({ where: { groupId: s.groupId, event: 'expense.deleted' } });
    expect(act.payload).toMatchObject({ actor: 'Alon', description: 'Dinner', affectedMemberIds: expect.arrayContaining([s.a, s.n, s.r]) });
    expect(await prisma.expense.count({ where: { id: created.id } })).toBe(1);
  });

  it('keeps expenses private to members and to their own group', async () => {
    const s = await setup();
    const other = await setup();
    const stranger = await guest('Eve');
    const mine = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(201)).body;
    await stranger.api('get', `/groups/${s.groupId}/expenses`).expect(403);
    await stranger.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(403);
    await stranger.api('get', `/groups/${s.groupId}/balances`).expect(403);
    // an expense id from another group is "not found" even for a member of both
    await other.alon.api('get', `/groups/${other.groupId}/expenses/${mine.id}`).expect(404);
    await other.alon.api('patch', `/groups/${other.groupId}/expenses/${mine.id}`).send({ version: 1, description: 'x' }).expect(404);
    await other.alon.api('delete', `/groups/${other.groupId}/expenses/${mine.id}`).expect(404);
    // payer from another group
    await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { paidByMemberId: other.a })).expect(400);
  });

  it('is read-only once the group is closed', async () => {
    const s = await setup();
    const created = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(201)).body;
    await s.alon.api('post', `/groups/${s.groupId}/close`).expect(200);
    expect((await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s)).expect(409)).body.error.code).toBe('GROUP_CLOSED');
    await s.alon.api('patch', `/groups/${s.groupId}/expenses/${created.id}`).send({ version: 1, description: 'x' }).expect(409);
    await s.alon.api('delete', `/groups/${s.groupId}/expenses/${created.id}`).expect(409);
    await s.alon.api('get', `/groups/${s.groupId}/expenses/${created.id}`).expect(200);
  });

  it('presigns receipt uploads and ties receipts to their group', async () => {
    const s = await setup();
    const other = await setup();
    const up = (await s.alon.api('post', '/uploads/receipts').send({ groupId: s.groupId, contentType: 'image/jpeg', size: 200_000 }).expect(201)).body;
    expect(up.key).toMatch(new RegExp(`^receipts/${s.groupId}/[0-9a-f-]+\\.jpg$`));
    expect(up.uploadUrl).toContain('test-bucket');
    expect(up.uploadUrl).toContain('X-Amz-Signature');

    await s.alon.api('post', '/uploads/receipts').send({ groupId: s.groupId, contentType: 'application/pdf', size: 1000 }).expect(400);
    await s.alon.api('post', '/uploads/receipts').send({ groupId: s.groupId, contentType: 'image/png', size: 11 * 1024 * 1024 }).expect(400);
    await other.alon.api('post', '/uploads/receipts').send({ groupId: s.groupId, contentType: 'image/png', size: 1000 }).expect(403);

    const withReceipt = (await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { receiptKey: up.key })).expect(201)).body;
    expect(withReceipt.hasReceipt).toBe(true);
    const detail = (await s.alon.api('get', `/groups/${s.groupId}/expenses/${withReceipt.id}`).expect(200)).body;
    expect(detail.receiptUrl).toContain('X-Amz-Signature');
    await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { receiptKey: `receipts/${other.groupId}/x.jpg` })).expect(400);
    await s.alon.api('post', `/groups/${s.groupId}/expenses`).send(dinner(s, { receiptKey: `receipts/${s.groupId}/../${other.groupId}/x.jpg` })).expect(400);
  });

  it('serves currencies and rate previews', async () => {
    const s = await setup();
    const list = (await request(http()).get('/api/v1/fx/currencies').expect(200)).body;
    expect(list).toEqual(expect.arrayContaining([{ code: 'JPY', decimals: 0 }, { code: 'KWD', decimals: 3 }, { code: 'ILS', decimals: 2 }]));
    expect((await s.alon.api('get', `/fx/rate?from=EUR&to=ILS&date=${D1}`).expect(200)).body).toEqual({ rate: '3.9821', date: D1, source: 'market' });
    expect((await s.alon.api('get', '/fx/rate?from=ils&to=ILS').expect(200)).body.source).toBe('same');
    expect((await s.alon.api('get', '/fx/rate?from=XXX&to=ILS').expect(400)).body.error.code).toBe('UNSUPPORTED_CURRENCY');
    await request(http()).get('/api/v1/fx/rate?from=EUR&to=ILS').expect(401);
  });

  it('falls back to the newest cached rate when the feed is down', async () => {
    const s = await setup();
    await s.alon.api('get', `/fx/rate?from=EUR&to=ILS&date=${D1}`).expect(200); // cache D1
    const original = fakeFeed.fetchDay;
    fakeFeed.fetchDay = async () => {
      throw new Error('down');
    };
    try {
      // 2001-02-08 has no row and the feed is down: the newest cached day (D2, cached by an earlier test) is used and says so
      const later = (await s.alon.api('get', '/fx/rate?from=EUR&to=ILS&date=2001-02-08').expect(200)).body;
      expect(later).toEqual({ rate: '3.9821', date: D2, source: 'market' });
    } finally {
      fakeFeed.fetchDay = original;
    }
  });

  it('converts other currencies on the dashboard and flags the total as approximate', async () => {
    const alon = await guest('Alon');
    const g = (await alon.api('post', '/groups').send({ name: `t-${run} usd`, type: 'trip', currency: 'USD', members: [{ displayName: 'Noa' }] }).expect(201)).body;
    const [a, n] = g.members.map((m: { id: string }) => m.id) as string[];
    await alon.api('post', `/groups/${g.id}/expenses`).send({
      amount: 10000, description: 'Hotel', category: 'stay', paidByMemberId: a, date: TODAY, split: { mode: 'equal', included: [a, n] },
    }).expect(201);
    const d = (await alon.api('get', '/me/dashboard').expect(200)).body;
    // Noa owes Alon $50 → ₪99.55 at 1.99105
    expect(d.totals).toEqual([expect.objectContaining({ currency: 'USD', owedToMe: 5000 })]);
    expect(d.overall).toEqual({ currency: 'ILS', net: 9955, owedToMe: 9955, iOwe: 0, approximate: true, excludedCurrencies: [] });
  });
});
