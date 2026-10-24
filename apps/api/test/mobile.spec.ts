import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiError, createAuthApi, createSettledApi, unwrap } from '@settled/api-client';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { AppModule } from '../src/app.module';
import { EmailService } from '../src/email/email.service';
import { FxFeed } from '../src/fx/fx-feed';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

const run = Math.random().toString(36).slice(2, 8);
const D1 = '2001-03-03';
const realFetch = globalThis.fetch;
// Responses are not typed in the spec yet (services return plain objects), so tests name the fields they read
interface GroupBody { id: string; invite: { code: string }; members: { id: string }[] }
interface MeBody { id: string; name: string; email: string | null; isGuest: boolean }

/** Expo push API calls captured by the fetch spy; everything else goes to the real network (our own server). */
const expoCalls: { headers: Record<string, string>; body: { to: string; title: string; body: string; data: { url?: string } } }[] = [];
let expoReply: () => Response = () => Response.json({ data: { status: 'ok', id: 'ticket' } });

describe('mobile readiness: the API client against a running API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  const codes = new Map<string, string>();
  const userIds: string[] = [];

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(FxFeed)
      .useValue({ fetchDay: async (date: string) => ({ date, source: 'fawazahmed0' as const, perUsd: { ILS: '1.99105', USD: '1' } }) })
      .overrideProvider(EmailService)
      .useValue({ send: async () => {}, sendLoginCode: async (to: string, code: string) => void codes.set(to, code) })
      .compile();
    app = mod.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://exp.host/')) {
        expoCalls.push({ headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body)) });
        return expoReply();
      }
      return realFetch(input, init);
    });
  });

  afterEach(() => {
    expoCalls.length = 0;
    expoReply = () => Response.json({ data: { status: 'ok', id: 'ticket' } });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma.expense.deleteMany({ where: { group: { name: { startsWith: `t-${run}` } } } });
    await prisma.group.deleteMany({ where: { name: { startsWith: `t-${run}` } } });
    await prisma.idempotencyKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { OR: [{ id: { in: userIds } }, { email: { endsWith: '@mobile-test.example' } }] } });
    await app.close();
  });

  /** A native-app session: guest sign-in with no cookies and no Origin header, token held by the caller. */
  async function device(name: string) {
    let token: string | null = null;
    const auth = createAuthApi({ baseUrl, getToken: () => token });
    const signedIn = await auth.signInAnonymous();
    token = signedIn.token;
    userIds.push(signedIn.user.id);
    const api = createSettledApi({ baseUrl, getToken: () => token, onUnauthorized: () => (token = null) });
    await unwrap(api.PATCH('/me', { body: { name } }));
    return { api, auth, userId: signedIn.user.id, setToken: (t: string | null) => (token = t), token: () => token };
  }

  it('config is public; a protected route needs the token', async () => {
    const anon = createSettledApi({ baseUrl });
    expect(((await unwrap(anon.GET('/config'))) as { auth: { guest: boolean } }).auth.guest).toBe(true);
    await expect(unwrap(anon.GET('/me'))).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
  });

  it('guest sign-in returns a bearer token that authenticates /me', async () => {
    const d = await device('Dana');
    const me = (await unwrap(d.api.GET('/me'))) as MeBody;
    expect(me).toMatchObject({ id: d.userId, name: 'Dana', isGuest: true });
  });

  it('sign-out kills the token; later calls fail with SESSION_EXPIRED and fire onUnauthorized', async () => {
    const d = await device('Gone');
    await d.auth.signOut();
    const err = await unwrap(d.api.GET('/me')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    expect(d.token()).toBeNull();
  });

  it('email OTP on a device links the guest: same data, new token', async () => {
    const d = await device('Linker');
    const group = (await unwrap(d.api.POST('/groups', { body: { name: `t-${run} link`, type: 'trip', currency: 'ILS', members: [] } }))) as GroupBody;
    const email = `mobile-${run}@mobile-test.example`;
    await d.auth.sendEmailOtp(email);
    const signed = await d.auth.signInEmailOtp(email, codes.get(email)!);
    expect(signed.user).toMatchObject({ email, isAnonymous: false });
    d.setToken(signed.token);
    const me = await unwrap(d.api.GET('/me'));
    expect(me).toMatchObject({ email, isGuest: false });
    const groups = await unwrap(d.api.GET('/groups'));
    expect(JSON.stringify(groups)).toContain(group.id);
    userIds.push(signed.user.id);

    await expect(d.auth.signInEmailOtp(email, '000000')).rejects.toMatchObject({ code: 'INVALID_OTP' });
  });

  it('request validation errors come back as ApiError with field details', async () => {
    const d = await device('Val');
    const err = (await unwrap(d.api.PATCH('/me', { body: { defaultCurrency: 'ZZZ' } })).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(Object.keys((err.details as { fields: object }).fields)).toEqual(['defaultCurrency']);
  });

  describe('Expo push', () => {
    async function pair() {
      const alon = await device('Alon');
      const group = (await unwrap(
        alon.api.POST('/groups', { body: { name: `t-${run} push ${Math.random()}`, type: 'trip', currency: 'ILS', members: [{ displayName: 'Noa' }] } }),
      )) as GroupBody;
      const [a, n] = group.members.map((m) => m.id) as [string, string];
      const noa = await device('Noa');
      await unwrap(noa.api.POST('/invites/{code}/join', { params: { path: { code: group.invite.code } }, body: { claimMemberId: n } }));
      return { alon, noa, groupId: group.id, a, n };
    }
    const dinner = (s: { a: string; n: string }) => ({
      amount: 5000, description: 'Dinner', category: 'food', paidByMemberId: s.a, date: D1, split: { mode: 'equal', included: [s.a, s.n] },
    });

    it('registers an Expo token and pushes new-expense notifications to it', async () => {
      const s = await pair();
      const token = `ExponentPushToken[${run}-ok]`;
      await unwrap(s.noa.api.POST('/me/push-subscriptions', { body: { kind: 'expo', endpoint: token } }));
      await unwrap(s.alon.api.POST('/groups/{groupId}/expenses', { params: { path: { groupId: s.groupId } }, body: dinner(s) as never }));

      await vi.waitFor(() => expect(expoCalls).toHaveLength(1));
      const call = expoCalls[0]!;
      expect(call.body).toMatchObject({ to: token, data: { url: expect.stringContaining(s.groupId) } });
      expect(call.body.title).toBeTruthy();
      expect(call.headers.authorization).toBeUndefined(); // EXPO_ACCESS_TOKEN not set
      // the actor gets nothing
      expect(expoCalls.every((c) => c.body.to === token)).toBe(true);
    });

    it('removes a token Expo reports as DeviceNotRegistered', async () => {
      const s = await pair();
      const token = `ExponentPushToken[${run}-dead]`;
      await unwrap(s.noa.api.POST('/me/push-subscriptions', { body: { kind: 'expo', endpoint: token } }));
      expoReply = () => Response.json({ data: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } });
      await unwrap(s.alon.api.POST('/groups/{groupId}/expenses', { params: { path: { groupId: s.groupId } }, body: dinner(s) as never }));
      await vi.waitFor(async () => expect(await prisma.pushSubscription.count({ where: { endpoint: token } })).toBe(0));
    });

    it('keeps the token on a transient Expo failure', async () => {
      const s = await pair();
      const token = `ExponentPushToken[${run}-flaky]`;
      await unwrap(s.noa.api.POST('/me/push-subscriptions', { body: { kind: 'expo', endpoint: token } }));
      expoReply = () => new Response('busy', { status: 503 });
      await unwrap(s.alon.api.POST('/groups/{groupId}/expenses', { params: { path: { groupId: s.groupId } }, body: dinner(s) as never }));
      await vi.waitFor(() => expect(expoCalls).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 100));
      expect(await prisma.pushSubscription.count({ where: { endpoint: token } })).toBe(1);
    });

    it('can unregister the device (sign-out flow)', async () => {
      const d = await device('Unreg');
      const sub = await unwrap(d.api.POST('/me/push-subscriptions', { body: { kind: 'expo', endpoint: `ExponentPushToken[${run}-unreg]` } }));
      await unwrap(d.api.DELETE('/me/push-subscriptions/{id}', { params: { path: { id: (sub as { id: string }).id } } }));
      expect(await prisma.pushSubscription.count({ where: { userId: d.userId } })).toBe(0);
    });
  });
});
