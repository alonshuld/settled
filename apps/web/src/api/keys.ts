/**
 * Query-key factory. One entry per domain; later steps add theirs here so invalidation stays by prefix:
 *   queryClient.invalidateQueries({ queryKey: qk.groups.detail(id) })  // everything under that group
 *
 * Hook conventions (see api/config.ts):
 *  - one file per domain in src/api/, exporting `useX` (query) / `useXMutation` hooks
 *  - queryFn = `unwrap(api.GET(...))` from '@/lib/api', never raw fetch
 *  - creating mutations send `Idempotency-Key: idempotencyKey()` (generate once per submit attempt, reuse on retry)
 *  - mutations invalidate by key prefix in onSuccess; errors surface through the global toast (meta.silent opts out)
 */
export const qk = {
  config: ['config'] as const,
  me: {
    all: ['me'] as const,
    dashboard: () => ['me', 'dashboard'] as const,
    stats: () => ['me', 'stats'] as const,
  },
  groups: {
    all: ['groups'] as const,
    list: () => ['groups', 'list'] as const,
    detail: (id: string) => ['groups', id] as const,
    expenses: (id: string, params?: object) => ['groups', id, 'expenses', params ?? {}] as const,
    expense: (id: string, expenseId: string) => ['groups', id, 'expense', expenseId] as const,
    balances: (id: string) => ['groups', id, 'balances'] as const,
    settle: (id: string) => ['groups', id, 'settle'] as const,
    invite: (id: string) => ['groups', id, 'invite'] as const,
  },
  invites: { byCode: (code: string) => ['invites', code] as const },
  activity: {
    all: ['activity'] as const,
    list: (filter?: string) => ['activity', 'list', filter ?? 'all'] as const,
    counts: () => ['activity', 'counts'] as const,
  },
  fx: {
    currencies: () => ['fx', 'currencies'] as const,
    rate: (from: string, to: string, date: string) => ['fx', 'rate', from, to, date] as const,
  },
} as const;
