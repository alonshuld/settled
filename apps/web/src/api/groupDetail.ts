import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberBalance, Transfer } from '@settled/core';
import { api, unwrap } from '@/lib/api';
import type { Category } from './expenses';
import type { GroupType } from './groups';
import { qk } from './keys';

// GET /groups/{id}, /balances, /invite and the member endpoints are typed `{}` in the OpenAPI spec; these
// mirror GroupsService.detail / member / inviteView and BalancesService.detail in apps/api.

export interface InviteView {
  /** Display form, e.g. `KR7-4QX`. */
  code: string;
  url: string;
  expiresAt: string | null;
}

export interface GroupMemberView {
  id: string;
  displayName: string;
  color: string;
  role: 'owner' | 'member';
  gender: 'male' | 'female' | null;
  /** Added by name, hasn't joined yet. */
  isPlaceholder: boolean;
  isMe: boolean;
  /** Contact details are only present for placeholders. */
  email: string | null;
  phone: string | null;
  joinedAt: string | null;
  /** Members who left stay in the list (their old expenses still name them). */
  leftAt: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  type: GroupType;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  closedAt: string | null;
  createdAt: string;
  members: GroupMemberView[];
  invite: InviteView | null;
  stats: {
    totalSpent: number;
    myShare: number;
    iPaid: number;
    /** Positive = owed to me. */
    myNet: number;
  };
  expenseCount: number;
}

export interface GroupBalances {
  currency: string;
  totalSpent: number;
  members: MemberBalance[];
  transfers: Transfer[];
  byCategory: { category: Category; amount: number }[];
  expenseCount: number;
}

export function useGroup(id: string) {
  return useQuery({
    queryKey: qk.groups.detail(id),
    queryFn: () => unwrap(api.GET('/groups/{groupId}', { params: { path: { groupId: id } } })) as Promise<GroupDetail>,
  });
}

export function useGroupBalances(id: string) {
  return useQuery({
    queryKey: qk.groups.balances(id),
    queryFn: () =>
      unwrap(api.GET('/groups/{groupId}/balances', { params: { path: { groupId: id } } })) as Promise<GroupBalances>,
  });
}

export function useInvite(id: string, enabled: boolean, initial?: InviteView | null) {
  return useQuery({
    queryKey: qk.groups.invite(id),
    queryFn: () => unwrap(api.GET('/groups/{groupId}/invite', { params: { path: { groupId: id } } })) as Promise<InviteView>,
    enabled,
    initialData: initial ?? undefined,
  });
}

/** Everything that depends on the group's membership or state; list cards and the dashboard follow. */
function useRefresh(groupId: string) {
  const qc = useQueryClient();
  return () =>
    qc
      .invalidateQueries({ queryKey: qk.groups.detail(groupId) })
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.groups.list() }), qc.invalidateQueries({ queryKey: qk.me.all })]));
}

export function useRotateInviteMutation(groupId: string) {
  const qc = useQueryClient();
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST('/groups/{groupId}/invite/rotate', { params: { path: { groupId } } })) as Promise<InviteView>,
    onSuccess: (invite) => {
      qc.setQueryData(qk.groups.invite(groupId), invite);
      return refresh();
    },
  });
}

export interface MemberInput {
  displayName: string;
  email?: string;
  phone?: string;
}

export function useAddMemberMutation(groupId: string) {
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: (body: MemberInput) =>
      unwrap(api.POST('/groups/{groupId}/members', { params: { path: { groupId } }, body })) as Promise<GroupMemberView>,
    onSuccess: refresh,
  });
}

export function useRenameMemberMutation(groupId: string) {
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: ({ memberId, displayName }: { memberId: string; displayName: string }) =>
      unwrap(
        api.PATCH('/groups/{groupId}/members/{memberId}', { params: { path: { groupId, memberId } }, body: { displayName } }),
      ),
    onSuccess: refresh,
  });
}

export function useRemoveMemberMutation(groupId: string) {
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: (memberId: string) =>
      unwrap(api.DELETE('/groups/{groupId}/members/{memberId}', { params: { path: { groupId, memberId } } })),
    onSuccess: refresh,
  });
}

export function useLeaveGroupMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.POST('/groups/{groupId}/leave', { params: { path: { groupId } } })),
    onSuccess: async () => {
      // The group is no longer ours: drop it instead of refetching a 403.
      qc.removeQueries({ queryKey: qk.groups.detail(groupId) });
      await Promise.all([qc.invalidateQueries({ queryKey: qk.groups.list() }), qc.invalidateQueries({ queryKey: qk.me.all })]);
    },
  });
}

export function useSetClosedMutation(groupId: string) {
  const refresh = useRefresh(groupId);
  return useMutation({
    mutationFn: (closed: boolean) =>
      unwrap(
        api.POST(closed ? '/groups/{groupId}/close' : '/groups/{groupId}/reopen', { params: { path: { groupId } } }),
      ),
    onSuccess: refresh,
  });
}
