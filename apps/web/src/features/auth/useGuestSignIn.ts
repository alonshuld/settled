import { useTranslation } from 'react-i18next';
import { authClient, resetSessionData } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';

/** Anonymous sign-in. Resolves null once the guest session exists, else a message to show. */
export function useGuestSignIn() {
  const { t } = useTranslation();

  return async function guestSignIn(): Promise<string | null> {
    const res = await authClient.signIn.anonymous();
    if (res.error) return errorMessage(t, res.error);
    resetSessionData();
    return null;
  };
}
