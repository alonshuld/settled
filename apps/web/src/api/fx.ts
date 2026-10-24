import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

/** Market rate: `to` units per 1 `from` on `date`. Only asked for when an expense is in a foreign currency. */
export function useFxRate(from: string, to: string, date: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.fx.rate(from, to, date),
    queryFn: () => unwrap(api.GET('/fx/rate', { params: { query: { from, to, date } } })),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
    meta: { silent: true },
  });
}
