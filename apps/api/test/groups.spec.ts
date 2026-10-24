import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const ORIGIN = 'http://localhost:3000';
const run = Math.random().toString(36).slice(2, 8);

describe('groups', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  const userIds: string[] = [];
  afterAll(async () => {
    // Members are restricted by their expenses' shares, so remove expenses before the groups
    await prisma.expense.deleteMany({ where: { group: { name: { startsWith: `t-${run}` } } } });
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
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

  async function newGroup(owner: Client, extra: Record<string, unknown> = {}) {
    const res = await owner
      .api('post', '/groups')
      .send({ name: `t-${run} trip`, type: 'trip', currency: 'ILS', members: [{ displayName: 'Noa' }, { displayName: 'Roni' }], ...extra })
      .expect(201);
    return res.body;
  }

  /** Alon paid `amount`, split equally between everyone in the group. */
  async function addExpense(groupId: string, paidBy: string, amount: number) {
    const members = await prisma.member.findMany({ where: { groupId }, orderBy: { sortOrder: 'asc' } });
    const each = Math.floor(amount / members.length);
    await prisma.expense.create({
      data: {
        groupId, description: 'x', category: 'other', amount, currency: 'ILS', fxRate: 1, fxSource: 'same', baseAmount: amount,
        paidByMemberId: paidBy, date: new Date(), splitMode: 'equal', createdById: paidBy,
        shares: { create: members.map((m, i) => ({ memberId: m.id, amount: i === 0 ? amount - each * (members.length - 1) : each })) },
      },
    });
  }

  it('creates a group with owner, placeholders and an invite', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon, { startDate: '2026-10-12', endDate: '2026-10-18' });
    expect(g.members).toHaveLength(3);
    expect(g.members[0]).toMatchObject({ displayName: 'Alon', role: 'owner', isMe: true, color: '#C6F135' });
    expect(g.members[1]).toMatchObject({ displayName: 'Noa', isPlaceholder: true });
    expect(g.invite.code).toMatch(/^[2-9A-Z]{3}-[2-9A-Z]{3}$/);
    expect(g.stats).toEqual({ totalSpent: 0, myShare: 0, iPaid: 0, myNet: 0 });
    expect(g.startDate).toBe('2026-10-12');
  });

  it('validates input', async () => {
    const alon = await guest('Alon');
    const bad = await alon.api('post', '/groups').send({ name: 'x', type: 'trip', currency: 'XXX' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    const dates = await alon.api('post', '/groups').send({ name: 'x', type: 'trip', currency: 'ILS', startDate: '2026-10-18', endDate: '2026-10-12' }).expect(400);
    expect(dates.body.error.details.fields.endDate).toBeDefined();
  });

  it('only members can see a group', async () => {
    const alon = await guest('Alon');
    const stranger = await guest('Eve');
    const g = await newGroup(alon);
    const res = await stranger.api('get', `/groups/${g.id}`).expect(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');
    expect((await stranger.api('get', '/groups').expect(200)).body).toEqual([]);
  });

  it('lists active and closed groups; owner closes and reopens', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    const active = await alon.api('get', '/groups').expect(200);
    expect(active.body[0]).toMatchObject({ id: g.id, memberCount: 3, myNet: 0, settled: true, closedAt: null });
    await alon.api('post', `/groups/${g.id}/close`).expect(200);
    expect((await alon.api('get', '/groups?status=active').expect(200)).body).toEqual([]);
    expect((await alon.api('get', '/groups?status=closed').expect(200)).body).toHaveLength(1);
    await alon.api('patch', `/groups/${g.id}`).send({ name: 'new' }).expect(409);
    await alon.api('post', `/groups/${g.id}/reopen`).expect(200);
  });

  it('join: preview, new member, claim, idempotency, atomic claim', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    const code = g.invite.code as string;
    const noaId = g.members.find((m: { displayName: string }) => m.displayName === 'Noa').id;

    const peek = await request(http()).get(`/api/v1/invites/${code}`).expect(200);
    expect(peek.body).toMatchObject({ invitedBy: { name: 'Alon' }, group: { memberCount: 3, expenseCount: 0, currency: 'ILS' } });
    expect(peek.body.claimable.map((c: { displayName: string }) => c.displayName)).toEqual(['Noa', 'Roni']);
    await request(http()).get('/api/v1/invites/ZZZ-ZZZ').expect(404);
    await request(http()).get('/api/v1/invites/garbage').expect(404);

    const noa = await guest('Noa Cohen');
    const joined = await noa.api('post', `/invites/${code}/join`).send({ claimMemberId: noaId }).expect(200);
    expect(joined.body).toEqual({ groupId: g.id, memberId: noaId });
    const again = await noa.api('post', `/invites/${code.toLowerCase()}/join`).expect(200);
    expect(again.body.memberId).toBe(noaId);

    const view = await noa.api('get', `/groups/${g.id}`).expect(200);
    expect(view.body.members.find((m: { isMe: boolean }) => m.isMe)).toMatchObject({ displayName: 'Noa', isPlaceholder: false });

    const late = await guest('Late');
    const res = await late.api('post', `/invites/${code}/join`).send({ claimMemberId: noaId }).expect(409);
    expect(res.body.error.code).toBe('MEMBER_ALREADY_CLAIMED');
    expect((await late.api('get', `/groups/${g.id}`).expect(403)).body.error.code).toBe('NOT_A_MEMBER');

    const fresh = await late.api('post', `/invites/${code}/join`).send({}).expect(200);
    const row = await prisma.member.findUniqueOrThrow({ where: { id: fresh.body.memberId } });
    expect(row).toMatchObject({ displayName: 'Late', userId: late.userId });
  });

  it('closed groups reject joins; rotated codes stop working', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    const old = g.invite.code as string;
    const rotated = await alon.api('post', `/groups/${g.id}/invite/rotate`).expect(200);
    expect(rotated.body.code).not.toBe(old);
    await request(http()).get(`/api/v1/invites/${old}`).expect(404);

    await alon.api('post', `/groups/${g.id}/close`).expect(200);
    const other = await guest('Other');
    const res = await other.api('post', `/invites/${rotated.body.code}/join`).expect(409);
    expect(res.body.error.code).toBe('GROUP_CLOSED');

    await prisma.invite.update({ where: { groupId: g.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(http()).get(`/api/v1/invites/${rotated.body.code}`).expect(410);
    expect(expired.body.error.code).toBe('INVITE_EXPIRED');
  });

  it('owner-only actions are forbidden for members', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    const bob = await guest('Bob');
    await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    for (const [m, p] of [['patch', ''], ['post', '/close'], ['post', '/invite/rotate'], ['delete', '']] as const) {
      const res = await bob.api(m, `/groups/${g.id}${p}`).send({}).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  it('placeholder members: add, edit, remove, protected once they have money', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    const added = await alon.api('post', `/groups/${g.id}/members`).send({ displayName: 'Dan', phone: '+972501234567' }).expect(201);
    expect(added.body).toMatchObject({ displayName: 'Dan', isPlaceholder: true, phone: '+972501234567' });
    const edited = await alon.api('patch', `/groups/${g.id}/members/${added.body.id}`).send({ displayName: 'Daniel' }).expect(200);
    expect(edited.body.displayName).toBe('Daniel');
    await alon.api('delete', `/groups/${g.id}/members/${added.body.id}`).expect(204);

    const roni = g.members.find((m: { displayName: string }) => m.displayName === 'Roni');
    await addExpense(g.id, g.members[0].id, 3000);
    const res = await alon.api('delete', `/groups/${g.id}/members/${roni.id}`).expect(409);
    expect(res.body.error.code).toBe('MEMBER_HAS_ACTIVITY');

    // real members can only be edited by themselves
    expect((await alon.api('patch', `/groups/${g.id}/members/${g.members[0].id}`).send({ gender: 'male' }).expect(200)).body.gender).toBe('male');
    const bob = await guest('Bob');
    const joined = await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    await alon.api('patch', `/groups/${g.id}/members/${joined.body.memberId}`).send({ displayName: 'x' }).expect(403);
  });

  it('balances feed stats, cards, leave rule and currency lock', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    await addExpense(g.id, g.members[0].id, 9000); // 3 people, 3000 each

    const detail = await alon.api('get', `/groups/${g.id}`).expect(200);
    expect(detail.body.stats).toEqual({ totalSpent: 9000, myShare: 3000, iPaid: 9000, myNet: 6000 });
    expect(detail.body.expenseCount).toBe(1);

    const card = (await alon.api('get', '/groups').expect(200)).body[0];
    expect(card).toMatchObject({ myNet: 6000, settled: false });

    const res = await alon.api('patch', `/groups/${g.id}`).send({ currency: 'USD' }).expect(409);
    expect(res.body.error.code).toBe('CURRENCY_LOCKED');
    expect((await alon.api('delete', `/groups/${g.id}`).expect(409)).body.error.code).toBe('GROUP_HAS_EXPENSES');

    const bob = await guest('Bob');
    const joined = await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    await addExpense(g.id, joined.body.memberId, 400); // bob now has a non-zero net
    const leave = await bob.api('post', `/groups/${g.id}/leave`).expect(409);
    expect(leave.body.error.code).toBe('LEAVE_WITH_OPEN_BALANCE');
    expect((await alon.api('post', `/groups/${g.id}/leave`).expect(403)).body.error.code).toBe('FORBIDDEN');
  });

  it('leaving at zero keeps the member in history and removes group access', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon, { members: [] });
    const bob = await guest('Bob');
    const joined = await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    await bob.api('post', `/groups/${g.id}/leave`).expect(204);
    await bob.api('get', `/groups/${g.id}`).expect(403);
    const row = await prisma.member.findUniqueOrThrow({ where: { id: joined.body.memberId } });
    expect(row.leftAt).not.toBeNull();
    const back = await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    expect(back.body.memberId).toBe(joined.body.memberId);
    await bob.api('get', `/groups/${g.id}`).expect(200);
  });

  it('owner deletes an empty group', async () => {
    const alon = await guest('Alon');
    const g = await newGroup(alon);
    await alon.api('delete', `/groups/${g.id}`).expect(204);
    await alon.api('get', `/groups/${g.id}`).expect(403);
  });

  it('dashboard totals, groups and needsAttention', async () => {
    const alon = await guest('Alon');
    const bob = await guest('Bob');
    const empty = await alon.api('get', '/me/dashboard').expect(200);
    expect(empty.body).toMatchObject({ totals: [], groups: [], needsAttention: [], overall: { net: 0, currency: 'ILS' } });

    const g = await newGroup(alon, { members: [] });
    const joined = await bob.api('post', `/invites/${g.invite.code}/join`).expect(200);
    await addExpense(g.id, g.members[0].id, 9000); // two people: 4500 each -> bob owes 4500

    const a = (await alon.api('get', '/me/dashboard').expect(200)).body;
    expect(a.totals).toEqual([
      { currency: 'ILS', net: 4500, owedToMe: 4500, iOwe: 0, owedByPeople: 1, owedInGroups: 1, oweToPeople: 0, oweInGroups: 0 },
    ]);
    expect(a.overall).toMatchObject({ net: 4500, owedToMe: 4500, approximate: false });
    expect(a.groups).toHaveLength(1);
    expect(a.needsAttention).toEqual([
      { kind: 'owedToMe', groupId: g.id, groupName: g.name, currency: 'ILS', memberId: joined.body.memberId, name: 'Bob', amount: 4500 },
    ]);

    const b = (await bob.api('get', '/me/dashboard').expect(200)).body;
    expect(b.totals[0]).toMatchObject({ net: -4500, iOwe: 4500, oweToPeople: 1, oweInGroups: 1 });
    expect(b.needsAttention[0]).toMatchObject({ kind: 'iOwe', name: 'Alon', amount: 4500 });
  });
});
