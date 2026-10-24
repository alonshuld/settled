import { describe, expect, it } from 'vite-plus/test';
import { ApiError, createAuthApi, createSettledApi, unwrap } from '../src/index.js';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { ...init, headers: { 'content-type': 'application/json', ...init.headers } });

describe('api client', () => {
  it('adds the bearer token and the /api/v1 prefix', async () => {
    const seen: Request[] = [];
    const api = createSettledApi({
      baseUrl: 'https://api.example.com/',
      getToken: () => 'tok',
      fetch: async (req: RequestInfo | URL) => (seen.push(req as Request), json({ id: 'u1' })),
    });
    const me = await unwrap(api.GET('/me'));
    expect(me).toEqual({ id: 'u1' });
    expect(seen[0]!.url).toBe('https://api.example.com/api/v1/me');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer tok');
  });

  it('sends no auth header when signed out', async () => {
    let auth: string | null = 'x';
    const api = createSettledApi({ baseUrl: 'https://a.test', fetch: async (r: RequestInfo | URL) => ((auth = (r as Request).headers.get('authorization')), json({})) });
    await api.GET('/config');
    expect(auth).toBeNull();
  });

  it('unwrap throws ApiError with the server code, and 401 triggers onUnauthorized', async () => {
    let called: ApiError | undefined;
    const api = createSettledApi({
      baseUrl: 'https://a.test',
      onUnauthorized: (e: ApiError) => (called = e),
      fetch: async () => json({ error: { code: 'SESSION_EXPIRED', message: 'x', requestId: 'req_1' } }, { status: 401 }),
    });
    const err = await unwrap(api.GET('/me')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'SESSION_EXPIRED', requestId: 'req_1', isAuthError: true });
    expect(called?.code).toBe('SESSION_EXPIRED');
  });

  it('auth helpers read the token from set-auth-token and map errors', async () => {
    const ok = createAuthApi({
      baseUrl: 'https://a.test',
      fetch: async () => json({ user: { id: 'u', name: 'Anonymous', email: 'temp@guest', isAnonymous: true } }, { headers: { 'set-auth-token': 'T' } }),
    });
    expect(await ok.signInAnonymous()).toEqual({ token: 'T', user: { id: 'u', name: 'Anonymous', email: null, isAnonymous: true } });

    const bad = createAuthApi({ baseUrl: 'https://a.test', fetch: async () => json({ code: 'INVALID_OTP', message: 'Invalid OTP' }, { status: 400 }) });
    await expect(bad.signInEmailOtp('a@b.c', '000000')).rejects.toMatchObject({ status: 400, code: 'INVALID_OTP' });
  });
});
