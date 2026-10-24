# @settled/api-client

Typed client for the Settled (Shulam) API, for the mobile app (and the web app if it wants it). Design: `docs/backend/BACKEND_DESIGN.md` §2, §3, step 8 notes.

## How it is built
```
NestJS controllers + ZodPipe schemas
   └─ pnpm --filter @settled/api openapi        -> packages/api-client/openapi.json   (OpenAPI 3.0, committed)
        └─ pnpm --filter @settled/api-client generate   -> src/schema.ts            (openapi-typescript, committed, never edit)
             └─ pnpm --filter @settled/api-client build  -> dist/                   (tsc)
```
- Request bodies and query strings come from the same Zod schemas the API validates with, so the spec cannot drift. Responses are **not typed yet** (services return plain objects): they come back as `unknown`, so cast or narrow at the call site. Adding a response schema per route is the follow-up that would close this.
- `openapi.json` is checked in. `apps/api/test/openapi.spec.ts` fails when a route or schema changes without regenerating it, so API changes show up in review. After changing a controller run both generate commands above and commit the results.
- Runtime is [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch/) (tiny, uses the platform `fetch`, works in React Native / Expo). TanStack Query hooks are not generated; wrap calls in `useQuery`/`useMutation` in the app (or add `openapi-react-query`).

## Versioning
Semver in `package.json`. Bump the minor for new routes or fields, the major for removed or changed ones (the `/api/v1` prefix only changes for a major). The API is versioned by URL, so an old app build keeps working against the same `/api/v1` as long as only additive changes ship.

## Consuming it
**From this monorepo (default):** add `"@settled/api-client": "workspace:*"` to the app's dependencies. Run `pnpm build` first (`main` points at `dist/`). Expo/Metro needs the monorepo set up for workspaces (`watchFolders`, `nodeModulesPaths`); with a separate repo use the tarball below.

**Without a workspace (free):** `pnpm --filter @settled/api-client pack` makes `settled-api-client-0.1.0.tgz` (the `prepack` script builds it); install that file in the app, or use a git dependency on this repo. Nothing is published anywhere.

**npm (not done, would be free for a public package):** the package is `"private": true` as a guard. To publish: remove `private`, make sure the name/scope is yours (`@settled` is not registered), `pnpm --filter @settled/api-client publish --access public`. Be aware that a public package exposes the API surface.

## Usage
```ts
import * as SecureStore from 'expo-secure-store';
import { createAuthApi, createSettledApi, unwrap, idempotencyKey } from '@settled/api-client';

const baseUrl = 'https://api.shulam.app'; // origin only
const getToken = () => SecureStore.getItem('session');

export const auth = createAuthApi({ baseUrl, getToken });
export const api = createSettledApi({
  baseUrl,
  getToken,
  onUnauthorized: () => { SecureStore.deleteItemAsync('session'); /* navigate to sign-in */ },
});

// Sign in (guest, email OTP or Google ID token) and keep the token
const { token } = await auth.signInAnonymous();
SecureStore.setItem('session', token);
await unwrap(api.PATCH('/me', { body: { name: 'Dana' } }));

// Typed paths, params and bodies; errors become ApiError with a stable `code`
const group = await unwrap(
  api.POST('/groups', { body: { name: 'Eilat', type: 'trip', currency: 'ILS', members: [] }, headers: { 'Idempotency-Key': idempotencyKey() } }),
);
```
- **Sign-in flows:** `signInAnonymous()`; `sendEmailOtp(email)` then `signInEmailOtp(email, code)` (a guest's token passed through `getToken` makes it link the guest, design §5.2); `signInGoogle(idToken)` with the ID token from the native Google SDK (needs `GOOGLE_CLIENT_ID/SECRET` on the API and the app's client ID allowed there). `signOut()`.
- **Token:** the `set-auth-token` response header of sign-in, sent back as `Authorization: Bearer`. Same 30-day rolling session as web. Native requests carry no cookies and no `Origin`, so no CORS or CSRF origin setup is needed. If the app uses a deep link scheme for OAuth callbacks, set `MOBILE_ORIGINS=settled://` on the API.
- **Errors:** every non-2xx throws `ApiError { status, code, message, details, requestId }`; `code` maps to the dialogs in the design handoff (§4.4).

## Expo push
1. In the app: `Notifications.getExpoPushTokenAsync()` (needs a physical device and an EAS project ID; both free).
2. Register it after sign-in: `api.POST('/me/push-subscriptions', { body: { kind: 'expo', endpoint: token } })` (upsert; a token moves to whoever registered last, so call it on every sign-in).
3. On sign-out, `DELETE /me/push-subscriptions/{id}` using the `id` returned at registration.
4. Notifications carry `data.url`, an app path such as `/groups/<id>`; route to it on tap.
5. Optional: set `EXPO_ACCESS_TOKEN` on the API if you turn on Expo's enhanced push security. Android additionally needs FCM credentials uploaded to EAS (free); iOS push needs an Apple developer account (paid, outside this project's zero-cost constraint, so iOS push stays untested until then).
