import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { mergeGuestInto } from '../src/auth/guest-merge';
import { OtpLimiter } from '../src/auth/otp-limiter';
import { EmailService } from '../src/email/email.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const ORIGIN = 'http://localhost:3000';
const run = Math.random().toString(36).slice(2, 8);
const emailOf = (n: string) => `${n}-${run}@auth-test.example`;

describe('auth', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const codes = new Map<string, string>();
  const http = () => app.getHttpServer();

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue({ sendLoginCode: async (to: string, code: string) => void codes.set(to, code) })
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
    await prisma.user.deleteMany({ where: { OR: [{ email: { endsWith: '@auth-test.example' } }, { id: { startsWith: 'merge-' + run } }] } });
    await app.close();
  });

  const post = (path: string) => request(http()).post(path).set('Origin', ORIGIN);

  /** Signs in a guest; returns the session cookie and bearer token. */
  async function guest(name: string) {
    const res = await post('/api/auth/sign-in/anonymous').send({}).expect(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    return { cookie, token: res.headers['set-auth-token'] as string, userId: res.body.user.id as string, name };
  }

  /** Email OTP sign-in. Pass a guest cookie to link that guest. */
  async function signInWithEmail(to: string, cookie?: string) {
    await post('/api/auth/email-otp/send-verification-otp').send({ email: to, type: 'sign-in' }).expect(200);
    const req = post('/api/auth/sign-in/email-otp');
    if (cookie) req.set('Cookie', cookie);
    return req.send({ email: to, otp: codes.get(to) });
  }

  it('GET /config is public and hides phone login', async () => {
    const res = await request(http()).get('/api/v1/config').expect(200);
    expect(res.body.auth).toEqual({ google: false, emailOtp: true, phoneOtp: false, guest: true });
  });

  it('rejects requests without a session', async () => {
    const res = await request(http()).get('/api/v1/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('reports an invalid credential as SESSION_EXPIRED', async () => {
    const res = await request(http()).get('/api/v1/me').set('Authorization', 'Bearer nope').expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('guest session works with cookie and bearer token', async () => {
    const g = await guest('Guest');
    const viaCookie = await request(http()).get('/api/v1/me').set('Cookie', g.cookie).expect(200);
    expect(viaCookie.body).toMatchObject({ id: g.userId, isGuest: true, email: null, methods: { email: false } });
    await request(http()).get('/api/v1/me').set('Authorization', `Bearer ${g.token}`).expect(200);
  });

  it('email OTP signs a new user in', async () => {
    const to = emailOf('new');
    const res = await signInWithEmail(to);
    expect(res.status).toBe(200);
    const token = res.headers['set-auth-token'] as string;
    const me = await request(http()).get('/api/v1/me').set('Authorization', `Bearer ${token}`).expect(200);
    expect(me.body).toMatchObject({ email: to, isGuest: false, methods: { email: true, google: false, phone: false } });
  });

  it('wrong OTP is rejected, and the code is dead after 3 attempts', async () => {
    const to = emailOf('attempts');
    await post('/api/auth/email-otp/send-verification-otp').send({ email: to, type: 'sign-in' }).expect(200);
    for (let i = 0; i < 3; i++) {
      const r = await post('/api/auth/sign-in/email-otp').send({ email: to, otp: '000000' }).expect(400);
      expect(r.body.code).toBe('INVALID_OTP');
    }
    const locked = await post('/api/auth/sign-in/email-otp').send({ email: to, otp: '000000' }).expect(403);
    expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
    // even the right code no longer works
    await post('/api/auth/sign-in/email-otp').send({ email: to, otp: codes.get(to) }).expect(400);
  });

  it('linking email upgrades a guest: memberships move to the account', async () => {
    const g = await guest('Linker');
    const group = await prisma.group.create({
      data: { name: `t-${run}-link`, type: 'trip', currency: 'ILS', createdById: g.userId, members: { create: { displayName: 'Linker', color: '#000', sortOrder: 0, userId: g.userId, role: 'owner' } } },
      include: { members: true },
    });
    const to = emailOf('linked');
    const res = await signInWithEmail(to, g.cookie);
    expect(res.status).toBe(200);
    const member = await prisma.member.findUnique({ where: { id: group.members[0]!.id } });
    const account = await prisma.user.findUnique({ where: { email: to } });
    expect(member?.userId).toBe(account?.id);
    expect(await prisma.user.findUnique({ where: { id: g.userId } })).toBeNull();
  });

  it('PATCH /me validates and saves', async () => {
    const g = await guest('Patcher');
    const auth = { Authorization: `Bearer ${g.token}` };
    const bad = await request(http()).patch('/api/v1/me').set(auth).send({ defaultCurrency: 'ZZZ', contactPhone: '050' }).expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(bad.body.error.details.fields)).toEqual(['defaultCurrency', 'contactPhone']);
    const ok = await request(http()).patch('/api/v1/me').set(auth).send({ name: 'Dana', locale: 'en', defaultCurrency: 'EUR', contactPhone: '+972501234567' }).expect(200);
    expect(ok.body).toMatchObject({ name: 'Dana', locale: 'en', defaultCurrency: 'EUR', contactPhone: '+972501234567' });
  });

  it('rate limits OTP sends per destination with Retry-After', async () => {
    const to = emailOf('limited');
    await post('/api/auth/email-otp/send-verification-otp').send({ email: to, type: 'sign-in' }).expect(200);
    const res = await post('/api/auth/email-otp/send-verification-otp').send({ email: to, type: 'sign-in' }).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  describe('mergeGuestInto', () => {
    it('keeps the guest member as a placeholder when the account is already in the group', async () => {
      const mk = (id: string) => prisma.user.create({ data: { id: `merge-${run}-${id}`, name: id } });
      const [guestU, target] = [await mk('g'), await mk('t')];
      const group = await prisma.group.create({
        data: {
          name: `t-${run}-conflict`, type: 'home', currency: 'ILS', createdById: target.id,
          members: { create: [
            { displayName: 'Guest', color: '#111', sortOrder: 0, userId: guestU.id },
            { displayName: 'Target', color: '#222', sortOrder: 1, userId: target.id },
          ] },
        },
        include: { members: true },
      });
      const result = await prisma.$transaction((tx) => mergeGuestInto(tx, guestU.id, target.id));
      expect(result.moved).toBe(0);
      expect(result.conflicts).toHaveLength(1);
      const guestMember = group.members.find((m) => m.displayName === 'Guest')!;
      expect((await prisma.member.findUnique({ where: { id: guestMember.id } }))?.userId).toBeNull();
    });
  });
});

describe('OtpLimiter', () => {
  it('enforces cooldown, hourly caps and per-IP caps', () => {
    let t = 0;
    const l = new OtpLimiter({ cooldownMs: 60_000, perDestinationPerHour: 3, perIpPerHour: 4, now: () => t });
    l.check('A@x.com', '1.1.1.1');
    expect(() => l.check('a@x.com', '1.1.1.1')).toThrow(/Too many/); // cooldown, case-insensitive
    t += 61_000; l.check('a@x.com', '1.1.1.1');
    t += 61_000; l.check('a@x.com', '1.1.1.1');
    t += 61_000;
    expect(() => l.check('a@x.com', '1.1.1.1')).toThrow(); // 3 per hour
    l.check('b@x.com', '1.1.1.1'); // 4th from this IP
    t += 61_000;
    expect(() => l.check('c@x.com', '1.1.1.1')).toThrow(); // IP cap
    l.check('c@x.com', '2.2.2.2');
    t += 3_600_000; l.check('a@x.com', '1.1.1.1'); // window passed
  });
});
