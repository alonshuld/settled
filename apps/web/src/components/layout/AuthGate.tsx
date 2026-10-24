import { Navigate, Outlet, useLocation } from 'react-router';
import { HomeLoading } from '@/features/shell/HomeLoading';
import { Splash } from '@/features/shell/Splash';
import { useSession } from '@/lib/auth';
import { errorCode } from '@/lib/errors';
import { loginPath } from '@/lib/nav';

/** Layout route for everything behind sign-in. Signed out -> /login, remembering where the user was going. */
export function AuthGate() {
  const { data, isPending, error, refetch } = useSession();
  const { pathname, search } = useLocation();

  if (isPending) return <HomeLoading />;
  if (!data) {
    // A failed session lookup (offline, server hiccup) is not "signed out": don't bounce to login.
    if (error && errorCode(error) !== 'UNAUTHENTICATED' && errorCode(error) !== 'UNKNOWN') {
      return <Splash failed onRetry={() => void refetch()} />;
    }
    return <Navigate to={loginPath(pathname + search)} replace />;
  }
  return <Outlet />;
}
