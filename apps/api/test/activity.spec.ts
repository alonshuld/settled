import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { CronService } from '../src/cron/cron.service';
import { DigestService } from '../src/digest/digest.service';
import { digestWeekStart } from '../src/digest/week';
import { EmailService } from '../src/email/email.service';
import { FxFeed } from '../src/fx/fx-feed';
import { PushService } from '../src/notifications/push.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const ORIGIN = 'http://localhost:3000';
const run = Math.random().toString(36).slice(2, 8);
const D1 = '2001-03-03';
const TODAY = new Date().toISOString().slice(0, 10);

const fakeFeed = {
  async fetchDay(date: string) {
    return { date: date === 'latest' ? TODAY : date, source: 'fawazahmed0' as const, perUsd: { ILS: '1.99105', EUR: '0.5', USD: '1' } };
  },
};
const pushed: { userId: string; title: string; body: string; url?: string }[] = [];
const fakePush = {
  async send(userId: string, msg: { title: string; body: string; url?: string }) {
    pushed.push({ userId, ...msg });
  },
};
const mails: { to: string; subject: string; text: string }[] = [];
const fakeEmail = {
  async send(mail: { to: string; subject: string; text: string }) {
    mails.push(mail);
  },
  async sendLoginCode() {},
};

describe('activity & settings', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FxFeed)
      .useValue(fakeFeed)
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .overrideProvider(PushService)
      .useValue(fakePush)
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.expense.deleteMany({ where: { group: { name: { startsWith: `t-${run}` } } } });
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  beforeEach(() => {
    pushed.length = 0;
    mails.length = 0;
  });

  async function guest(name: string) {
    const res = await request(http()).post('/api/auth/sign-in/anonymous').set('Origin', ORIGIN).send({}).expect(200);
    const token = res.headers['set-auth-token'] as string;
    userIds.push(res.body.user.id);
    await request(http()).patch('/api/v1/me').set('Authorization', `Bearer ${token}`).send({ name }).expect(200);
    const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) =>
      request(http())[m](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    return { api, userId: res.body.user.id as string };
  }
  type Client = Awaited<ReturnType<typeof guest>>;

  /** Alon (owner) and Noa (joined) and Roni (placeholder). Alon paid 300 split three ways. */
  async function setup() {
    const alon = await guest('Alon');
    const g = (
      await alon
        .api('post', '/groups')
        .send({ name: `t-${run} trip`, type: 'trip', currency: 'ILS', members: [{ displayName: 'Noa' }, { displayName: 'Roni' }] })
        .expect(201)
    ).body;
    const [a, n, r] = g.members.map((m: { id: string }) => m.id) as [string, string, string];
    const noa = await guest('Noa');
    await noa.api('post', `/invites/${g.invite.code}/join`).send({ claimMemberId: n }).expect(200);
    const expense = (
      await alon
        .api('post', `/groups/${g.id}/expenses`)
        .send({ amount: 30000, description: 'Dinner', category: 'food', paidByMemberId: a, date: D1, split: { mode: 'equal', included: [a, n, r] } })
        .expect(201)
    ).body;
    pushed.length = 0;
    return { alon, noa, groupId: g.id as string, a, n, r, expense };
  }

  const addExpense = (c: Client, s: { groupId: string; a: string }, included: string[], description = 'Taxi') =>
    c.api('post', `/groups/${s.groupId}/expenses`).send({ amount: 6000, description, category: 'transport', paidByMemberId: s.a, date: D1, split: { mode: 'equal', included } }).expect(201);

  describe('feed', () => {
    it('lists group items newest first, with unread, counts and mark-read', async () => {
      const s = await setup();
      const feed = (await s.noa.api('get', '/activity').expect(200)).body;
      const events = feed.items.map((i: { event: string }) => i.event);
      expect(events[0]).toBe('expense.created');
      expect(events).toContain('member.joined');
      expect(feed.nextCursor).toBeNull();
      expect(feed.items[0]).toMatchObject({ groupId: s.groupId, groupName: `t-${run} trip`, type: 'expense', unread: true, actor: { name: 'Alon' } });
      // her own join is not new to her
      expect(feed.items.find((i: { event: string }) => i.event === 'member.joined').unread).toBe(false);

      const counts = (await s.noa.api('get', '/activity/counts').expect(200)).body;
      expect(counts).toMatchObject({ expense: 1, member: expect.any(Number), payment: 0, reminder: 0 });
      expect(counts.all).toBe(feed.items.length);
      expect(counts.unread).toBeGreaterThan(0);

      await s.noa.api('post', '/activity/mark-read').send({}).expect(204);
      expect((await s.noa.api('get', '/activity/counts').expect(200)).body.unread).toBe(0);
      // a stale watermark cannot make items unread again
      await s.noa.api('post', '/activity/mark-read').send({ upTo: '2001-01-01T00:00:00Z' }).expect(204);
      expect((await s.noa.api('get', '/activity/counts').expect(200)).body.unread).toBe(0);
      await addExpense(s.alon, s, [s.a, s.n]);
      expect((await s.noa.api('get', '/activity/counts').expect(200)).body.unread).toBe(1);
    });

    it('filters by type and paginates', async () => {
      const s = await setup();
      for (let i = 0; i < 3; i++) await addExpense(s.alon, s, [s.a, s.n], `Taxi ${i}`);
      const only = (await s.alon.api('get', '/activity?type=expense').expect(200)).body.items;
      expect(only.every((i: { type: string }) => i.type === 'expense')).toBe(true);
      expect(only).toHaveLength(4);

      const p1 = (await s.alon.api('get', '/activity?type=expense&limit=3').expect(200)).body;
      expect(p1.items).toHaveLength(3);
      expect(p1.nextCursor).toEqual(expect.any(String));
      const p2 = (await s.alon.api('get', `/activity?type=expense&limit=3&cursor=${p1.nextCursor}`).expect(200)).body;
      expect(p2.items).toHaveLength(1);
      expect(p2.nextCursor).toBeNull();
      expect([...p1.items, ...p2.items].map((i: { id: string }) => i.id)).toEqual(only.map((i: { id: string }) => i.id));

      await s.alon.api('get', '/activity?cursor=garbage').expect(400);
      await s.alon.api('get', '/activity?type=nope').expect(400);
    });

    it('group feed is members only, and private items reach only their audience', async () => {
      const s = await setup();
      const outsider = await guest('Eve');
      await outsider.api('get', `/groups/${s.groupId}/activity`).expect(403);
      expect((await outsider.api('get', '/activity').expect(200)).body.items).toEqual([]);

      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.n, tone: 'friendly', channel: 'push' }).expect(201);
      const noaItems = (await s.noa.api('get', `/groups/${s.groupId}/activity?type=reminder`).expect(200)).body.items;
      expect(noaItems.map((i: { event: string }) => i.event)).toEqual(['reminder.received']);
      const alonItems = (await s.alon.api('get', `/groups/${s.groupId}/activity?type=reminder`).expect(200)).body.items;
      expect(alonItems.map((i: { event: string }) => i.event)).toEqual(['reminder.sent']);
    });

    it('feeds the dashboard recent activity', async () => {
      const s = await setup();
      const dash = (await s.noa.api('get', '/me/dashboard').expect(200)).body;
      expect(dash.recentActivity.length).toBeGreaterThan(0);
      expect(dash.recentActivity.length).toBeLessThanOrEqual(5);
      expect(dash.recentActivity[0].event).toBe('expense.created');
    });
  });

  describe('push fan-out', () => {
    it('always tells people whose balance moved, and others by their preference', async () => {
      const s = await setup();
      await s.noa.api('patch', '/me/notification-prefs').send({ newExpenses: false }).expect(200);

      // Noa is not in the split: her preference decides
      await addExpense(s.alon, s, [s.a, s.r]);
      expect(pushed).toEqual([]);
      await s.noa.api('patch', '/me/notification-prefs').send({ newExpenses: true }).expect(200);
      await addExpense(s.alon, s, [s.a, s.r]);
      expect(pushed.map((p) => p.userId)).toEqual([s.noa.userId]);
      expect(pushed[0]).toMatchObject({ url: `/groups/${s.groupId}` });
      expect(pushed[0]!.body).toContain('Taxi');

      // Noa is in the split: pushed even with the preference off; never the actor
      pushed.length = 0;
      await s.noa.api('patch', '/me/notification-prefs').send({ newExpenses: false }).expect(200);
      await addExpense(s.alon, s, [s.a, s.n]);
      expect(pushed.map((p) => p.userId)).toEqual([s.noa.userId]);
    });

    it('collapses repeat edits within 5 minutes into one push, and tells Noa about deletes', async () => {
      const s = await setup();
      let version = s.expense.version as number;
      for (const amount of [31000, 32000, 33000]) {
        const res = await s.alon.api('patch', `/groups/${s.groupId}/expenses/${s.expense.id}`).send({ amount, version }).expect(200);
        version = res.body.version;
      }
      expect(pushed).toHaveLength(1);
      expect(pushed[0]!.userId).toBe(s.noa.userId);
      // every activity row is kept
      const rows = await prisma.activity.count({ where: { groupId: s.groupId, event: 'expense.updated' } });
      expect(rows).toBe(3);

      await s.alon.api('delete', `/groups/${s.groupId}/expenses/${s.expense.id}`).expect(204);
      expect(pushed).toHaveLength(2);
      expect(pushed[1]!.body).toMatch(/מחק/);
    });

    it('a no-op edit pushes nothing; the recipient locale picks the language', async () => {
      const s = await setup();
      await s.alon.api('patch', `/groups/${s.groupId}/expenses/${s.expense.id}`).send({ amount: 30000, version: s.expense.version }).expect(200);
      expect(pushed).toEqual([]);
      await s.noa.api('patch', '/me').send({ locale: 'he' }).expect(200);
      await addExpense(s.alon, s, [s.a, s.n]);
      expect(pushed[0]!.body).toMatch(/הוסיף/);
    });

    it('payments: claim goes to the creditor, confirm and reject to the payer', async () => {
      const s = await setup();
      const claim = (await s.noa.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201)).body;
      expect(pushed.map((p) => p.userId)).toEqual([s.alon.userId]);

      pushed.length = 0;
      await s.alon.api('post', `/groups/${s.groupId}/settlements/${claim.id}/confirm`).expect(200);
      expect(pushed.map((p) => p.userId)).toEqual([s.noa.userId]);

      pushed.length = 0;
      await s.alon.api('patch', '/me/notification-prefs').send({ paymentsReceived: false }).expect(200);
      // Roni is a placeholder: nobody to push; Alon marking it received tells nobody
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.r, toMemberId: s.a, amount: 10000 }).expect(201);
      expect(pushed).toEqual([]);
    });

    it('reminders: only the push channel pushes, and the recipient preference applies', async () => {
      const s = await setup();
      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.n, tone: 'friendly', channel: 'push' }).expect(201);
      expect(pushed.map((p) => p.userId)).toEqual([s.noa.userId]);

      pushed.length = 0;
      await prisma.reminder.deleteMany({ where: { groupId: s.groupId } });
      await s.noa.api('patch', '/me/notification-prefs').send({ remindersToMe: false }).expect(200);
      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.n, tone: 'friendly', channel: 'push' }).expect(201);
      expect(pushed).toEqual([]);
    });
  });

  describe('settings', () => {
    it('payment details: empty by default, replaced as a whole, validated', async () => {
      const u = await guest('Dana');
      expect((await u.api('get', '/me/payment-details').expect(200)).body).toEqual({ bitPhone: null, payboxPhone: null, paypalMe: null, revolutTag: null, bankDetails: null });
      const put = await u.api('put', '/me/payment-details').send({ bitPhone: '050-123 4567', paypalMe: 'dana.k', bankDetails: 'Leumi · 800 · 123' }).expect(200);
      expect(put.body).toEqual({ bitPhone: '050-123 4567', payboxPhone: null, paypalMe: 'dana.k', revolutTag: null, bankDetails: 'Leumi · 800 · 123' });
      // a field left out (or empty) is cleared
      const next = await u.api('put', '/me/payment-details').send({ revolutTag: '@dana', bankDetails: '' }).expect(200);
      expect(next.body).toEqual({ bitPhone: null, payboxPhone: null, paypalMe: null, revolutTag: '@dana', bankDetails: null });
      await u.api('put', '/me/payment-details').send({ paypalMe: 'not a handle!' }).expect(400);
      await u.api('put', '/me/payment-details').send({ unknown: 'x' }).expect(400);
    });

    it('notification prefs: defaults, partial update, shown on /me', async () => {
      const u = await guest('Dana');
      expect((await u.api('get', '/me/notification-prefs').expect(200)).body).toEqual({ remindersToMe: true, newExpenses: true, paymentsReceived: true, weeklySummary: false });
      const res = await u.api('patch', '/me/notification-prefs').send({ weeklySummary: true, newExpenses: false }).expect(200);
      expect(res.body).toEqual({ remindersToMe: true, newExpenses: false, paymentsReceived: true, weeklySummary: true });
      expect((await u.api('get', '/me').expect(200)).body.notificationPrefs).toEqual(res.body);
      await u.api('patch', '/me/notification-prefs').send({ newExpenses: 'yes' }).expect(400);
    });

    it('push subscriptions: add, move between users, delete only your own', async () => {
      const a = await guest('Dana');
      const b = await guest('Eli');
      const web = { kind: 'webpush', endpoint: `https://push.example.com/${run}`, keys: { p256dh: 'p', auth: 'a' } };
      const { id } = (await a.api('post', '/me/push-subscriptions').send(web).expect(201)).body;
      expect((await a.api('post', '/me/push-subscriptions').send(web).expect(201)).body.id).toBe(id); // same device again
      await b.api('delete', `/me/push-subscriptions/${id}`).expect(404);
      await a.api('delete', `/me/push-subscriptions/${id}`).expect(204);
      await a.api('delete', `/me/push-subscriptions/${id}`).expect(404);

      await a.api('post', '/me/push-subscriptions').send({ kind: 'webpush', endpoint: 'http://insecure.example.com/x', keys: { p256dh: 'p', auth: 'a' } }).expect(400);
      await a.api('post', '/me/push-subscriptions').send({ kind: 'webpush', endpoint: web.endpoint }).expect(400);
      await a.api('post', '/me/push-subscriptions').send({ kind: 'expo', endpoint: 'nope' }).expect(400);
      await a.api('post', '/me/push-subscriptions').send({ kind: 'expo', endpoint: `ExponentPushToken[${run}]` }).expect(201);
    });

    it('stats: my share, paid back to me, reminders sent; validates month', async () => {
      const s = await setup();
      const month = D1.slice(0, 7);
      // Alon is owed 100 by Noa; Noa pays it and Alon confirms
      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.r, tone: 'neutral', channel: 'push' }).expect(422); // placeholder has no push
      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.n, tone: 'neutral', channel: 'push' }).expect(201);
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201);

      const now = new Date().toISOString().slice(0, 7);
      const alon = (await s.alon.api('get', `/me/stats?month=${now}`).expect(200)).body;
      expect(alon).toMatchObject({ month: now, remindersSent: 1 });
      expect(alon.perCurrency).toEqual([{ currency: 'ILS', myShareOfExpenses: 0, paidBackToMe: 10000 }]);

      const old = (await s.noa.api('get', `/me/stats?month=${month}`).expect(200)).body;
      expect(old.perCurrency).toEqual([{ currency: 'ILS', myShareOfExpenses: 10000, paidBackToMe: 0 }]);
      expect(old.remindersSent).toBe(0);

      expect((await s.noa.api('get', '/me/stats').expect(200)).body.month).toBe(now);
      await s.noa.api('get', '/me/stats?month=2026-13').expect(400);
    });
  });

  describe('delete account', () => {
    it('needs the confirmation word', async () => {
      const u = await guest('Dana');
      await u.api('delete', '/me').send({}).expect(400);
      await u.api('delete', '/me').send({ confirm: 'delete' }).expect(400);
    });

    it('keeps the person as a placeholder, passes ownership on, and removes their data', async () => {
      const s = await setup();
      await s.noa.api('put', '/me/payment-details').send({ bitPhone: '0501234567' }).expect(200);
      await s.noa.api('post', '/me/push-subscriptions').send({ kind: 'expo', endpoint: `ExponentPushToken[${run}-del]` }).expect(201);
      await s.alon.api('post', `/groups/${s.groupId}/reminders`).send({ toMemberId: s.n, tone: 'friendly', channel: 'push' }).expect(201);

      // Alon (owner) deletes his account; Noa is the only one left with a login
      await s.alon.api('delete', '/me').send({ confirm: 'DELETE' }).expect(204);
      await s.alon.api('get', '/me').expect(401);

      const group = (await s.noa.api('get', `/groups/${s.groupId}`).expect(200)).body;
      const alonMember = group.members.find((m: { id: string }) => m.id === s.a);
      expect(alonMember).toMatchObject({ displayName: 'Alon', role: 'member', isPlaceholder: true });
      expect(group.members.find((m: { id: string }) => m.id === s.n).role).toBe('owner');

      // balances and history are unchanged
      const bal = (await s.noa.api('get', `/groups/${s.groupId}/balances`).expect(200)).body;
      expect(bal.members.find((m: { memberId: string }) => m.memberId === s.a).net).toBe(20000);
      const feed = (await s.noa.api('get', `/groups/${s.groupId}/activity`).expect(200)).body.items;
      expect(feed.some((i: { event: string; actor: { name: string } | null }) => i.event === 'expense.created' && i.actor?.name === 'Alon')).toBe(true);

      expect(await prisma.user.findUnique({ where: { id: s.alon.userId } })).toBeNull();
      expect(await prisma.activity.count({ where: { audienceUserId: s.alon.userId } })).toBe(0);

      // Noa leaves nothing behind either, and the group goes with its last member
      await s.noa.api('delete', '/me').send({ confirm: 'DELETE' }).expect(204);
      expect(await prisma.paymentDetails.count({ where: { userId: s.noa.userId } })).toBe(0);
      expect(await prisma.pushSubscription.count({ where: { userId: s.noa.userId } })).toBe(0);
      expect(await prisma.group.findUnique({ where: { id: s.groupId } })).toBeNull();
    });

    it('a member who is not the owner can leave without touching ownership', async () => {
      const s = await setup();
      await s.noa.api('delete', '/me').send({ confirm: 'DELETE' }).expect(204);
      const group = (await s.alon.api('get', `/groups/${s.groupId}`).expect(200)).body;
      expect(group.members.find((m: { id: string }) => m.id === s.a).role).toBe('owner');
      expect(group.members.find((m: { id: string }) => m.id === s.n)).toMatchObject({ displayName: 'Noa', isPlaceholder: true });
    });
  });

  describe('weekly digest', () => {
    it('lists who owes whom for users with the summary on, in their language', async () => {
      const s = await setup();
      const digest = app.get(DigestService);
      expect(await digest.lines(s.noa.userId, 'en')).toEqual([`t-${run} trip: you owe Alon ₪100`]);
      expect((await digest.lines(s.alon.userId, 'en')).sort()).toEqual([`t-${run} trip: Noa owes you ₪100`, `t-${run} trip: Roni owes you ₪100`]);

      await s.noa.api('patch', '/me/notification-prefs').send({ weeklySummary: true }).expect(200);
      const out = await digest.run();
      expect(out.sent).toBeGreaterThanOrEqual(1);
      expect(pushed.filter((p) => p.userId === s.noa.userId)).toHaveLength(1);
      expect(pushed.filter((p) => p.userId === s.alon.userId)).toHaveLength(0); // summary is opt-in
      expect(mails).toEqual([]); // guests have no email
    });

    it('skips users with nothing to report', async () => {
      const u = await guest('Dana');
      await u.api('patch', '/me/notification-prefs').send({ weeklySummary: true }).expect(200);
      await app.get(DigestService).run();
      expect(pushed.filter((p) => p.userId === u.userId)).toEqual([]);
    });

    it('week starts on Sunday 09:00 Jerusalem time, across DST', () => {
      // Sun 2026-10-25 09:00 IST (UTC+2) = 07:00Z (DST ended 2026-10-25 at 01:00 local)
      expect(digestWeekStart(new Date('2026-10-25T07:00:00Z')).toISOString()).toBe('2026-10-25T07:00:00.000Z');
      expect(digestWeekStart(new Date('2026-10-25T06:59:00Z')).toISOString()).toBe('2026-10-18T06:00:00.000Z'); // previous Sunday, still summer time
      expect(digestWeekStart(new Date('2026-10-28T12:00:00Z')).toISOString()).toBe('2026-10-25T07:00:00.000Z');
      expect(digestWeekStart(new Date('2026-07-15T12:00:00Z')).toISOString()).toBe('2026-07-12T06:00:00.000Z');
    });

    it('cron runs it once per week', async () => {
      await prisma.cronRun.deleteMany({ where: { task: 'digest.weekly' } });
      const svc = app.get(CronService);
      expect((await svc.tick())['digest.weekly']).toBeDefined();
      expect((await svc.tick())['digest.weekly']).toBeUndefined();
    });
  });
});
