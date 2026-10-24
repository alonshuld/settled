import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components, paths } from '@settled/api-client';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

// The OpenAPI spec types these responses as `{}` (no response DTOs for them yet), so the shapes mirror
// the services in apps/api (groups.service `cards`/`detail`, dashboard.service, invites.service).

export type GroupType = 'trip' | 'home' | 'event' | 'meal' | 'gift' | 'other';
export const GROUP_TYPES: readonly GroupType[] = ['trip', 'home', 'event', 'meal', 'gift', 'other'];

export interface GroupCard {
  id: string;
  name: string;
  type: GroupType;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  memberCount: number;
  /** Minor units; positive = owed to me. */
  myNet: number;
  settled: boolean;
  closedAt: string | null;
}

export interface CurrencyTotal {
  currency: string;
  net: number;
  owedToMe: number;
  iOwe: number;
  owedByPeople: number;
  owedInGroups: number;
  oweToPeople: number;
  oweInGroups: number;
}

export interface AttentionItem {
  kind: 'iOwe' | 'owedToMe';
  groupId: string;
  groupName: string;
  currency: string;
  memberId: string;
  name: string;
  amount: number;
}

export interface Dashboard {
  totals: CurrencyTotal[];
  overall: {
    currency: string;
    net: number;
    owedToMe: number;
    iOwe: number;
    /** Other currencies were converted at market rates. */
    approximate: boolean;
    excludedCurrencies: string[];
  };
  groups: GroupCard[];
  needsAttention: AttentionItem[];
}

export interface InvitePreview {
  group: {
    name: string;
    type: GroupType;
    startDate: string | null;
    endDate: string | null;
    memberCount: number;
    expenseCount: number;
    totalSpent: number;
    currency: string;
  };
  invitedBy: { name: string; color: string } | null;
  /** Placeholder members the joiner may claim as themselves. */
  claimable: { memberId: string; displayName: string; color: string }[];
}

export type CreateGroupBody = paths['/groups']['post']['requestBody']['content']['application/json'];
export type Currency = components['schemas']['Currency'];

export function useGroups(status: 'active' | 'closed' = 'active') {
  return useQuery({
    queryKey: [...qk.groups.list(), status],
    queryFn: () => unwrap(api.GET('/groups', { params: { query: { status } } })) as Promise<GroupCard[]>,
  });
}

/** Home screen: balances hero, every group card (closed ones included) and "needs attention". */
export function useDashboard() {
  return useQuery({
    queryKey: qk.me.dashboard(),
    queryFn: () => unwrap(api.GET('/me/dashboard')) as Promise<Dashboard>,
  });
}

export function useCurrencies() {
  return useQuery({
    queryKey: qk.fx.currencies(),
    queryFn: () => unwrap(api.GET('/fx/currencies')),
    staleTime: Infinity,
  });
}

/**
 * The idempotency key belongs to one submit attempt: the caller holds it (see NewGroupPage) so a retry after a
 * network failure replays the same request instead of creating a second group.
 */
export function useCreateGroupMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, key }: { body: CreateGroupBody; key: string }) => {
      const group = await unwrap(
        api.POST('/groups', { body, headers: { 'Idempotency-Key': key } }),
      );
      return group as { id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups.all }).then(() => qc.invalidateQueries({ queryKey: qk.me.all })),
  });
}

/** Public: works signed out. A 404/410 means the code is wrong or the invite expired. */
export function useInvitePreview(code: string | undefined) {
  return useQuery({
    queryKey: qk.invites.byCode(code ?? ''),
    queryFn: () => unwrap(api.GET('/invites/{code}', { params: { path: { code: code! } } })) as Promise<InvitePreview>,
    enabled: !!code,
    retry: false,
    meta: { silent: true },
  });
}

export function useJoinMutation(code: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (claimMemberId?: string) => {
      const res = await unwrap(
        api.POST('/invites/{code}/join', { params: { path: { code } }, body: claimMemberId ? { claimMemberId } : {} }),
      );
      return res as { groupId: string; memberId: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups.all }).then(() => qc.invalidateQueries({ queryKey: qk.me.all })),
  });
}
