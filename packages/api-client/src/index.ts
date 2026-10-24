import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema.js';

export type { components, operations, paths } from './schema.js';

/** Error body of every non-2xx response (design §4.4). */
export type ApiErrorBody = components['schemas']['ApiError']['error'];

/** Thrown by {@link unwrap} and the auth helpers. `code` is the stable server error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session is gone or invalid: send the user to sign-in. */
  get isAuthError() {
    return this.status === 401;
  }
}

export interface SettledClientOptions {
  /** API origin without a path, e.g. `https://api.shulam.app`. `/api/v1` and `/api/auth` are added for you. */
  baseUrl: string;
  /** Returns the stored session token (secure storage), or null when signed out. Called on every request. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Called after any 401 response, e.g. to clear the token and navigate to sign-in. */
  onUnauthorized?: (error: ApiError) => void;
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export type SettledApi = Client<paths>;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

function apiErrorFrom(res: Response, body: unknown): ApiError {
  const e = (body as { error?: Partial<ApiErrorBody> } | null)?.error;
  return new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? res.statusText, e?.details, e?.requestId);
}

async function toApiError(res: Response): Promise<ApiError> {
  return apiErrorFrom(res, await res.clone().json().catch(() => null));
}

/** Typed client for `/api/v1`, with the bearer token attached to every request. */
export function createSettledApi(options: SettledClientOptions): SettledApi {
  const client = createClient<paths>({
    baseUrl: `${trimSlash(options.baseUrl)}/api/v1`,
    fetch: (req) => (options.fetch ?? fetch)(req),
  });
  const auth: Middleware = {
    async onRequest({ request }) {
      const token = await options.getToken?.();
      if (token) request.headers.set('authorization', `Bearer ${token}`);
      return request;
    },
    async onResponse({ response }) {
      if (response.status === 401 && options.onUnauthorized) options.onUnauthorized(await toApiError(response));
      return response;
    },
  };
  client.use(auth);
  return client;
}

/**
 * Returns `data` or throws {@link ApiError}:
 * `const me = await unwrap(api.GET('/me'))`.
 */
export async function unwrap<T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<T> {
  const { data, error, response } = await call;
  // openapi-fetch has already consumed the body; `error` is the parsed JSON
  if (!response.ok) throw apiErrorFrom(response, error);
  return data as T;
}

/** A fresh `Idempotency-Key` value for creating endpoints (design §4.5). Reuse it when retrying the same action. */
export function idempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

export interface SignedIn {
  /** Store this in secure storage and return it from `getToken`. */
  token: string;
  user: { id: string; name: string; email: string | null; isAnonymous: boolean };
}

/**
 * Better Auth sign-in calls for native apps. They return the session token in the `set-auth-token`
 * response header (bearer plugin); no cookies are used. Other Better Auth endpoints are documented at
 * `/api/auth/*` and can be called with the same `baseUrl`.
 */
export function createAuthApi(options: Pick<SettledClientOptions, 'baseUrl' | 'getToken' | 'fetch'>) {
  const base = `${trimSlash(options.baseUrl)}/api/auth`;
  const doFetch = options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function call(path: string, body: unknown, bearer = false): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (bearer) {
      const token = await options.getToken?.();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await doFetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
    if (!res.ok) {
      // Better Auth errors are `{ code, message }`; the API's own errors are `{ error: {...} }`
      const raw = (await res.clone().json().catch(() => null)) as { code?: string; message?: string; error?: Partial<ApiErrorBody> } | null;
      if (raw?.error) throw await toApiError(res);
      throw new ApiError(res.status, raw?.code ?? 'INTERNAL', raw?.message ?? res.statusText);
    }
    return res;
  }

  async function signedIn(res: Response): Promise<SignedIn> {
    const token = res.headers.get('set-auth-token');
    const json = (await res.json()) as { user: { id: string; name: string; email?: string | null; isAnonymous?: boolean | null } };
    if (!token) throw new ApiError(res.status, 'INTERNAL', 'Sign-in succeeded but no session token was returned');
    const { user } = json;
    return { token, user: { id: user.id, name: user.name, email: user.isAnonymous ? null : (user.email ?? null), isAnonymous: Boolean(user.isAnonymous) } };
  }

  return {
    /** Guest account (design §5.2). Call `PATCH /me { name }` afterwards to set the display name. */
    signInAnonymous: async () => signedIn(await call('/sign-in/anonymous', {})),
    /** Step 1 of email OTP login: emails a 6 digit code. */
    sendEmailOtp: async (email: string) => void (await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })),
    /** Step 2. Pass the guest's token as `getToken` when signing in so the guest account is linked. */
    signInEmailOtp: async (email: string, otp: string) => signedIn(await call('/sign-in/email-otp', { email, otp }, true)),
    /** Google on device: pass the ID token from the native Google sign-in SDK (no browser redirect). */
    signInGoogle: async (idToken: string) =>
      signedIn(await call('/sign-in/social', { provider: 'google', idToken: { token: idToken } }, true)),
    /** Ends the session on the server; also drop the stored token. */
    signOut: async () => void (await call('/sign-out', {}, true)),
  };
}
