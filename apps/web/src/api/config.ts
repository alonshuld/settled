import { useQuery } from '@tanstack/react-query';
import { unwrap, api } from '@/lib/api';
import { qk } from './keys';

/**
 * Doubles as the "is the server awake" probe: on a Render cold start it keeps retrying with backoff
 * (about a minute in total) before the app gives up and shows the failure screen.
 */
export function useConfig() {
  return useQuery({
    queryKey: qk.config,
    queryFn: () => unwrap(api.GET('/config')),
    staleTime: 30 * 60_000,
    retry: 10,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    meta: { silent: true },
  });
}
