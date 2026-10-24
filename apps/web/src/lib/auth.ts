import { anonymousClient, emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { queryClient } from './query';

// Same-origin: the browser reaches /api/auth through the dev proxy / host rewrite, with cookie sessions.
export const authClient = createAuthClient({
  baseURL: location.origin,
  plugins: [emailOTPClient(), anonymousClient(), phoneNumberClient()],
});

export const useSession = authClient.useSession;

/** Whatever was cached belonged to the previous identity (e.g. guest merged into an account). */
export function resetSessionData() {
  queryClient.clear();
}

export async function signOut() {
  await authClient.signOut();
  resetSessionData();
}
