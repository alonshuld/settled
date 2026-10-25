import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

// GET /activity, /activity/counts and /me/stats are typed `unknown` in the OpenAPI spec; shapes follow
// apps/api activity.service.ts and me/settings.service.ts.
export type ActivityType = 'expense' | 'payment' | 'reminder' | 'member' | 'group';
export type ActivityFilter = 'all' | 'expense' | 'payment' | 'reminder' | 'member';

export interface ActivityItem {
  id: string;
  groupId: string;
  groupName: string;
  type: ActivityType;
  /** e.g. `expense.created`, `payment.confirmed`, `reminder.received`; payload shape depends on it. */
  event: string;
  actor: { memberId: string; name: string; color: string } | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  unread: boolean;
}

export interface ActivityPage {
  items: ActivityItem[];
  nextCursor: string | null;
}

export interface ActivityCounts {
  all: number;
  expense: number;
  payment: number;
  reminder: number;
  member: number;
  unread: number;
}

export interface MyStats {
  month: string;
  perCurrency: { currency: string; myShareOfExpenses: number; paidBackToMe: number }[];
  remindersSent: number;
}

const PAGE = 30;

export function useActivityFeed(filter: ActivityFilter) {
  return useInfiniteQuery({
    queryKey: qk.activity.list(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/activity', {
          params: { query: { limit: PAGE, ...(filter !== 'all' ? { type: filter } : {}), ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ) as Promise<ActivityPage>,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** First few items for the Home side panel. */
export function useRecentActivity(limit = 5) {
  return useQuery({
    queryKey: qk.activity.recent(),
    queryFn: () => unwrap(api.GET('/activity', { params: { query: { limit } } })) as Promise<ActivityPage>,
  });
}

/** Also drives the unread badge in the app shell, so it polls gently. */
export function useActivityCounts() {
  return useQuery({
    queryKey: qk.activity.counts(),
    queryFn: () => unwrap(api.GET('/activity/counts')) as Promise<ActivityCounts>,
    refetchInterval: 60_000,
    meta: { silent: true },
  });
}

export function useMarkAllReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/activity/mark-read', { body: {} })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.activity.all }),
  });
}

export function useMyStats() {
  return useQuery({
    queryKey: qk.me.stats(),
    queryFn: () => unwrap(api.GET('/me/stats')) as Promise<MyStats>,
  });
}
