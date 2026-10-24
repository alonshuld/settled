import { createSettledApi, unwrap, type SettledApi } from '@settled/api-client';
import { loginPath } from './nav';
import { queryClient } from './query';

export const api: SettledApi = createSettledApi({
  baseUrl: location.origin,
  onUnauthorized: () => {
    const { pathname, search } = location;
    if (pathname === '/login') return;
    queryClient.clear();
    // Full navigation: drops every in-memory trace of the old session, including Better Auth's cached one.
    location.assign(loginPath(pathname + search));
  },
});

export { unwrap };
