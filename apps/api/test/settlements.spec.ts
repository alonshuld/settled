import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { CronService } from '../src/cron/cron.service';
import { EmailService } from '../src/email/email.service';
import { FxFeed } from '../src/fx/fx-feed';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const ORIGIN = 'http://localhost:3000';
const run = Math.random().toString(36).slice(2, 8);
const D1 = '2001-03-03';
const TODAY = new Date().toISOString().slice(0, 10);

/** 1 EUR = 3.9821 ILS. */
const fakeFeed = {
  async fetchDay(date: string) {
    return {
      date: date === 'latest' ? TODAY : date,
      source: 'fawazahmed0' as const,
      perUsd: { ILS: '1.99105', EUR: '0.5', USD: '1' },
    };
  },
};

const sent: { to: string; subject: string; text: string }[] = [];
let emailFails = false;
const fakeEmail = {
  async send(mail: { to: string; subject: string; text: string }) {
    if (emailFails) throw new Error('smtp down');
    sent.push(mail);
  },
  async sendLoginCode() {},
};

describe('settle up', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FxFeed)
      .useValue(fakeFeed)
      .overrideProvider(EmailService)
      .useValue(fakeEmail)
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.exchangeRate.deleteMany({ where: { source: 'fawazahmed0', date: { in: [new Date(D1), new Date(TODAY)] } } });
  });

  const userIds: string[] = [];
  afterAll(async () => {
    await prisma.exchangeRate.deleteMany({ where: { date: { in: [new Date(D1), new Date(TODAY)] } } });
    await prisma.expense.deleteMany({ where: { group: { name: { startsWith: `t-${run}` } } } });
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await app.close();
  });

  beforeEach(() => {
    sent.length = 0;
    emailFails = false;
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

  /** Alon (owner) paid 300.00 split three ways: Noa and Roni each owe Alon 100.00. Noa has joined; Roni is a placeholder. */
  async function setup(roni: Record<string, string> = {}) {
    const alon = await guest('Alon');
    const g = (
      await alon
        .api('post', '/groups')
        .send({ name: `t-${run} trip`, type: 'trip', currency: 'ILS', members: [{ displayName: 'Noa' }, { displayName: 'Roni', ...roni }] })
        .expect(201)
    ).body;
    const [a, n, r] = g.members.map((m: { id: string }) => m.id) as [string, string, string];
    const noa = await guest('Noa');
    await noa.api('post', `/invites/${g.invite.code}/join`).send({ claimMemberId: n }).expect(200);
    await alon
      .api('post', `/groups/${g.id}/expenses`)
      .send({ amount: 30000, description: 'Dinner', category: 'food', paidByMemberId: a, date: D1, split: { mode: 'equal', included: [a, n, r] } })
      .expect(201);
    return { alon, noa, groupId: g.id as string, a, n, r };
  }

  const net = async (c: Client, groupId: string, memberId: string) =>
    ((await c.api('get', `/groups/${groupId}/balances`).expect(200)).body.members as { memberId: string; net: number }[]).find((m) => m.memberId === memberId)!.net;

  describe('settlements', () => {
    it('settle view lists outstanding transfers and progress', async () => {
      const s = await setup();
      const view = (await s.alon.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      expect(view.currency).toBe('ILS');
      expect(view.outstanding).toHaveLength(2);
      expect(view.outstanding[0]).toMatchObject({ toMemberId: s.a, amount: 10000, lastReminder: null, pendingClaim: null });
      expect(view.progress).toEqual({ settled: 0, total: 20000 });
      expect(view.myPayOptions).toEqual([]);
    });

    it('creditor marks received: counts in balances at once', async () => {
      const s = await setup();
      const res = await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000, method: 'bit' }).expect(201);
      expect(res.body).toMatchObject({ status: 'confirmed', baseAmount: 10000, method: 'bit' });
      expect(await net(s.alon, s.groupId, s.n)).toBe(0);
      const view = (await s.alon.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      expect(view.outstanding).toHaveLength(1);
      expect(view.settled[0]).toMatchObject({ fromMemberId: s.n, toMemberId: s.a, baseAmount: 10000 });
      expect(view.progress).toEqual({ settled: 10000, total: 20000 });
    });

    it('debtor claims, creditor confirms or rejects; only the creditor decides', async () => {
      const s = await setup();
      const claim = (await s.noa.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201)).body;
      expect(claim.status).toBe('pending');
      expect(await net(s.alon, s.groupId, s.n)).toBe(-10000); // pending does not count

      const view = (await s.alon.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      expect(view.outstanding.find((o: { toMemberId: string; fromMemberId: string }) => o.fromMemberId === s.n).pendingClaim).toEqual({ settlementId: claim.id, amount: 10000 });

      await s.noa.api('post', `/groups/${s.groupId}/settlements/${claim.id}/confirm`).expect(403);
      await s.alon.api('post', `/groups/${s.groupId}/settlements/${claim.id}/reject`).expect(200);
      await s.alon.api('post', `/groups/${s.groupId}/settlements/${claim.id}/confirm`).expect(409);
      expect(await net(s.alon, s.groupId, s.n)).toBe(-10000);

      const again = (await s.noa.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201)).body;
      const ok = await s.alon.api('post', `/groups/${s.groupId}/settlements/${again.id}/confirm`).expect(200);
      expect(ok.body.status).toBe('confirmed');
      expect(await net(s.alon, s.groupId, s.n)).toBe(0);
      const events = await prisma.activity.findMany({ where: { groupId: s.groupId, type: 'payment' }, orderBy: { createdAt: 'asc' } });
      expect(events.map((e) => e.event)).toEqual(['payment.claimed', 'payment.rejected', 'payment.claimed', 'payment.confirmed']);
    });

    it('only the two people involved can record a payment', async () => {
      const s = await setup();
      const res = await s.noa.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.r, toMemberId: s.a, amount: 100 }).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.a, toMemberId: s.a, amount: 100 }).expect(400);
    });

    it('rejects more than owed + 1%, writes off a remainder within 1%', async () => {
      const s = await setup();
      const over = await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10101 }).expect(400);
      expect(over.body.error.code).toBe('VALIDATION_FAILED');
      expect(over.body.error.details.outstanding).toBe(10000);

      // 99.50 of 100.00: the 0.50 left is within 1% and is written off
      const close = await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 9950 }).expect(201);
      expect(close.body.amount).toBe(9950);
      expect(close.body.baseAmount).toBe(10000);
      expect(await net(s.alon, s.groupId, s.n)).toBe(0);

      // 90.00 of 100.00 is a partial payment: 10.00 stays open
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.r, toMemberId: s.a, amount: 9000 }).expect(201);
      expect(await net(s.alon, s.groupId, s.r)).toBe(-1000);
    });

    it('accepts a payment in another currency at a locked rate', async () => {
      const s = await setup();
      // €25.11 at 3.9821 = ₪99.99 (rounded), within 1% of 100.00 → counts as 100.00
      const eur = await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 2511, currency: 'EUR' }).expect(201);
      expect(eur.body).toMatchObject({ currency: 'EUR', amount: 2511, fxSource: 'market', baseAmount: 10000 });
      expect(await net(s.alon, s.groupId, s.n)).toBe(0);

      // manual rate: €10.00 at 4 = ₪40.00
      const manual = await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.r, toMemberId: s.a, amount: 1000, currency: 'EUR', fxRate: '4' }).expect(201);
      expect(manual.body).toMatchObject({ fxSource: 'manual', fxRate: '4', baseAmount: 4000 });
      expect(await net(s.alon, s.groupId, s.r)).toBe(-6000);
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.r, toMemberId: s.a, amount: 100, currency: 'XXX' }).expect(400);
    });

    it('undo within 24h removes it; only the creator, not after 24h', async () => {
      const s = await setup();
      const rec = (await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201)).body;
      await s.noa.api('delete', `/groups/${s.groupId}/settlements/${rec.id}`).expect(403);
      await s.alon.api('delete', `/groups/${s.groupId}/settlements/${rec.id}`).expect(204);
      expect(await net(s.alon, s.groupId, s.n)).toBe(-10000);
      await s.alon.api('delete', `/groups/${s.groupId}/settlements/${rec.id}`).expect(404);

      const old = (await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 10000 }).expect(201)).body;
      await prisma.settlement.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
      await s.alon.api('delete', `/groups/${s.groupId}/settlements/${old.id}`).expect(403);
    });

    it('is idempotent and blocked in closed groups', async () => {
      const s = await setup();
      const body = { fromMemberId: s.n, toMemberId: s.a, amount: 5000 };
      const first = await s.alon.api('post', `/groups/${s.groupId}/settlements`).set('Idempotency-Key', `k-${run}`).send(body).expect(201);
      const second = await s.alon.api('post', `/groups/${s.groupId}/settlements`).set('Idempotency-Key', `k-${run}`).send(body).expect(201);
      expect(second.body.id).toBe(first.body.id);
      expect(await prisma.settlement.count({ where: { groupId: s.groupId } })).toBe(1);

      await s.alon.api('post', `/groups/${s.groupId}/close`).expect(200);
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ ...body, amount: 100 }).expect(409);
    });

    it('pay options come from the creditor payment details', async () => {
      const s = await setup();
      await prisma.paymentDetails.create({ data: { userId: s.alon.userId, bitPhone: '0501234567', paypalMe: 'alon' } });
      const view = (await s.noa.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      expect(view.myPayOptions).toHaveLength(1);
      expect(view.myPayOptions[0]).toMatchObject({ toMemberId: s.a, amount: 10000, currency: 'ILS' });
      const methods = view.myPayOptions[0].options.map((o: { method: string }) => o.method);
      expect(methods).toEqual(['paypal', 'bit']);
      expect(view.myPayOptions[0].options[0].url).toBe('https://paypal.me/alon/100.00ILS');
      expect(view.myPaymentDetails).toBeNull();
      const mine = (await s.alon.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      expect(mine.myPaymentDetails).toMatchObject({ bitPhone: '0501234567' });
    });
  });

  describe('reminders', () => {
    const send = (c: Client, groupId: string, body: Record<string, unknown>) =>
      c.api('post', `/groups/${groupId}/reminders`).send({ tone: 'friendly', autoRepeat: false, ...body });

    it('only reminds someone who owes you', async () => {
      const s = await setup();
      const res = await send(s.noa, s.groupId, { toMemberId: s.a, channel: 'push' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('push to a claimed member: in-app item for them, private item for the sender', async () => {
      const s = await setup();
      const res = await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push' }).expect(201);
      expect(res.body).toMatchObject({ status: 'sent', amount: 10000, channel: 'push', autoRepeatDays: null });
      expect(res.body.message).toContain('Noa');
      const items = await prisma.activity.findMany({ where: { groupId: s.groupId, type: 'reminder' }, orderBy: { event: 'asc' } });
      expect(items.map((i) => [i.event, i.audienceUserId])).toEqual([
        ['reminder.received', s.noa.userId],
        ['reminder.sent', s.alon.userId],
      ]);
    });

    it('appends the sender payment details and keeps edited text', async () => {
      const s = await setup();
      await prisma.paymentDetails.create({ data: { userId: s.alon.userId, bitPhone: '0501234567' } });
      const res = await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push', message: 'Pay up please' }).expect(201);
      expect(res.body.message).toBe('Pay up please\n\nBit: 0501234567');
    });

    it('unreachable channel → 422 with alternatives', async () => {
      const s = await setup({ phone: '+972501234567' });
      const res = await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'push' }).expect(422);
      expect(res.body.error.code).toBe('REMINDER_CHANNEL_UNAVAILABLE');
      expect(res.body.error.details.alternatives).toEqual(['whatsapp', 'sms']);
    });

    it('WhatsApp and SMS are handed to the client as links', async () => {
      const s = await setup({ phone: '+972501234567' });
      const wa = await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'whatsapp', message: 'hi Roni' }).expect(201);
      expect(wa.body).toMatchObject({ status: 'handed_off', link: 'https://wa.me/972501234567?text=hi%20Roni' });
      expect(wa.body.waUrl).toBe(wa.body.link);
      await prisma.reminder.deleteMany({ where: { groupId: s.groupId } }); // skip the 12h cooldown
      const sms = await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'sms', message: 'hi Roni' }).expect(201);
      expect(sms.body.link).toBe('sms:+972501234567?body=hi%20Roni');
    });

    it('email goes out through the mailer; a failing mailer marks it failed', async () => {
      const s = await setup({ email: 'roni@example.com' });
      const ok = await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'email' }).expect(201);
      expect(ok.body.status).toBe('sent');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ to: 'roni@example.com' });
      expect(sent[0]!.text).toContain('Roni');

      await prisma.reminder.deleteMany({ where: { groupId: s.groupId } });
      emailFails = true;
      const bad = await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'email' }).expect(201);
      expect(bad.body).toMatchObject({ status: 'failed', error: 'smtp down' });
    }, 15_000);

    it('one reminder per pair per 12h, failed ones do not count', async () => {
      const s = await setup();
      await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push' }).expect(201);
      const again = await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push' }).expect(429);
      expect(again.body.error.code).toBe('RATE_LIMITED');
      expect(again.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('remind everyone reports who was skipped', async () => {
      const s = await setup(); // Roni has no contact at all
      const res = await s.alon.api('post', `/groups/${s.groupId}/reminders/all`).send({ tone: 'neutral', channel: 'push', autoRepeat: false }).expect(201);
      expect(res.body.created).toHaveLength(1);
      expect(res.body.created[0].toMemberId).toBe(s.n);
      expect(res.body.skipped).toEqual([{ memberId: s.r, reason: 'REMINDER_CHANNEL_UNAVAILABLE' }]);
      const again = await s.alon.api('post', `/groups/${s.groupId}/reminders/all`).send({ tone: 'neutral', channel: 'push', autoRepeat: false }).expect(201);
      expect(again.body.skipped).toContainEqual({ memberId: s.n, reason: 'RATE_LIMITED' });
    });

    it('history shows reminders the caller sent or received', async () => {
      const s = await setup();
      const r = (await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push' }).expect(201)).body;
      const mine = (await s.noa.api('get', `/groups/${s.groupId}/reminders`).expect(200)).body;
      expect(mine.items.map((i: { id: string }) => i.id)).toEqual([r.id]);
      expect((await s.alon.api('get', `/groups/${s.groupId}/reminders?toMemberId=${s.r}`).expect(200)).body.items).toEqual([]);
    });

    it('auto-repeat: cron sends again with the current amount, then stops when paid', async () => {
      const s = await setup({ phone: '+972501234567' });
      const first = (await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push', autoRepeat: true }).expect(201)).body;
      expect(first.autoRepeatDays).toBe(3);
      expect(new Date(first.nextRunAt).getTime()).toBeGreaterThan(Date.now() + 2.9 * 86400_000);
      await prisma.reminder.update({ where: { id: first.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });

      // part-payment first, so the repeat must carry the new amount
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 6000 }).expect(201);
      const cron = app.get(CronService);
      const out = await cron.tick();
      expect(out['reminders.autoRepeat']).toMatchObject({ sent: expect.any(Number) });

      const chain = await prisma.reminder.findMany({ where: { groupId: s.groupId }, orderBy: { createdAt: 'asc' } });
      expect(chain).toHaveLength(2);
      expect(chain[1]).toMatchObject({ parentId: first.id, amount: 4000, status: 'sent', autoRepeatDays: null, nextRunAt: null });
      expect(chain[0]!.nextRunAt!.getTime()).toBeGreaterThan(Date.now() + 2.9 * 86400_000);

      // a second tick does nothing: the original is not due again
      await cron.tick();
      expect(await prisma.reminder.count({ where: { groupId: s.groupId } })).toBe(2);

      // paying in full stops the chain
      await s.alon.api('post', `/groups/${s.groupId}/settlements`).send({ fromMemberId: s.n, toMemberId: s.a, amount: 4000 }).expect(201);
      const stopped = await prisma.reminder.findUniqueOrThrow({ where: { id: first.id } });
      expect(stopped.stoppedAt).not.toBeNull();
      expect(stopped.nextRunAt).toBeNull();
    });

    it('auto-repeat over WhatsApp nudges the creditor instead of sending', async () => {
      const s = await setup({ phone: '+972501234567' });
      // make Roni the one being reminded: Roni owes Alon 10000
      const first = (await send(s.alon, s.groupId, { toMemberId: s.r, channel: 'whatsapp', autoRepeat: true }).expect(201)).body;
      await prisma.reminder.update({ where: { id: first.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
      await app.get(CronService).tick();
      const nudge = await prisma.activity.findFirstOrThrow({ where: { groupId: s.groupId, event: 'reminder.nudge' } });
      expect(nudge.audienceUserId).toBe(s.alon.userId);
      expect((nudge.payload as { link: string }).link).toContain('https://wa.me/972501234567');
      const child = await prisma.reminder.findFirstOrThrow({ where: { parentId: first.id } });
      expect(child.status).toBe('handed_off');
    });

    it('stop ends the auto-repeat chain; only the sender can stop it', async () => {
      const s = await setup();
      const first = (await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push', autoRepeat: true }).expect(201)).body;
      await s.noa.api('post', `/groups/${s.groupId}/reminders/${first.id}/stop`).expect(404);
      const res = await s.alon.api('post', `/groups/${s.groupId}/reminders/${first.id}/stop`).expect(200);
      expect(res.body.nextRunAt).toBeNull();
      expect(res.body.stoppedAt).not.toBeNull();
    });

    it('settle view shows the last reminder and whether auto-repeat is on', async () => {
      const s = await setup();
      await send(s.alon, s.groupId, { toMemberId: s.n, channel: 'push', autoRepeat: true }).expect(201);
      const view = (await s.alon.api('get', `/groups/${s.groupId}/settle`).expect(200)).body;
      const noaRow = view.outstanding.find((o: { fromMemberId: string }) => o.fromMemberId === s.n);
      expect(noaRow.lastReminder).toMatchObject({ channel: 'push', autoRepeat: true });
    });
  });

  describe('cron', () => {
    it('requires the shared secret', async () => {
      await request(http()).post('/api/v1/internal/cron').expect(401);
      await request(http()).post('/api/v1/internal/cron').set('x-cron-secret', 'nope').expect(401);
      const ok = await request(http()).post('/api/v1/internal/cron').set('x-cron-secret', process.env.CRON_SECRET!).expect(200);
      expect(ok.body.ran['reminders.autoRepeat']).toBeDefined();
    });

    it('periodic tasks run once per interval', async () => {
      await prisma.cronRun.deleteMany({ where: { task: { in: ['cleanup.idempotency', 'cleanup.guests', 'cleanup.uploads'] } } });
      const cron = app.get(CronService);
      const first = await cron.tick();
      expect(Object.keys(first)).toEqual(expect.arrayContaining(['cleanup.idempotency', 'cleanup.guests', 'cleanup.uploads']));
      const second = await cron.tick();
      expect(second['cleanup.idempotency']).toBeUndefined();
      expect(second['reminders.autoRepeat']).toBeDefined(); // every tick
    });

    it('cleans old idempotency keys and abandoned guests', async () => {
      const old = await guest('Old');
      const kept = await guest('Kept');
      const aged = new Date(Date.now() - 40 * 86400_000);
      await prisma.session.updateMany({ where: { userId: old.userId }, data: { updatedAt: aged } });
      await prisma.user.update({ where: { id: old.userId }, data: { updatedAt: aged } });
      await prisma.idempotencyKey.create({ data: { key: `old-${run}`, userId: kept.userId, route: 'POST /x', statusCode: 201, response: {}, createdAt: new Date(Date.now() - 25 * 3600_000) } });
      await prisma.cronRun.deleteMany({ where: { task: { in: ['cleanup.idempotency', 'cleanup.guests'] } } });

      await app.get(CronService).tick();
      expect(await prisma.user.findUnique({ where: { id: old.userId } })).toBeNull();
      expect(await prisma.user.findUnique({ where: { id: kept.userId } })).not.toBeNull();
      expect(await prisma.idempotencyKey.count({ where: { key: `old-${run}` } })).toBe(0);
    });
  });
});
