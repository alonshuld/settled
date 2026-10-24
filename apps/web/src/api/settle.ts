import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayOption, PaymentDetails, ReminderTone } from '@settled/core';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

// The settle/reminder endpoints are typed `{}` in the OpenAPI spec; these mirror SettlementsService.settleView /
// view and RemindersService.view in apps/api.

export type ReminderChannel = 'whatsapp' | 'sms' | 'email' | 'push';
export type PayMethod = 'bit' | 'paybox' | 'paypal' | 'revolut' | 'bank' | 'cash' | 'other';

export interface SettleTransfer {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  lastReminder: { sentAt: string; channel: ReminderChannel; autoRepeat: boolean } | null;
  /** The payer says they paid; the receiver has not confirmed yet. `amount` is in the group's currency. */
  pendingClaim: { settlementId: string; amount: number } | null;
}

export interface SettledPayment {
  settlementId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency: string;
  baseAmount: number;
  confirmedAt: string | null;
}

export interface SettleView {
  currency: string;
  outstanding: SettleTransfer[];
  settled: SettledPayment[];
  progress: { settled: number; total: number };
  myPaymentDetails: PaymentDetails | null;
  /** One entry per transfer where I am the payer. */
  myPayOptions: { toMemberId: string; amount: number; currency: string; options: PayOption[] }[];
}

export interface Reminder {
  id: string;
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  tone: ReminderTone;
  channel: ReminderChannel;
  message: string;
  locale: string;
  status: 'queued' | 'sent' | 'handed_off' | 'failed';
  error: string | null;
  autoRepeatDays: number | null;
  nextRunAt: string | null;
  stoppedAt: string | null;
  parentId: string | null;
  sentAt: string | null;
  createdAt: string;
  /** WhatsApp / SMS deep link, only on the create response. */
  link?: string | null;
  waUrl?: string | null;
}

export interface RemindAllResult {
  created: Reminder[];
  skipped: { memberId: string; reason: string }[];
}

export function useSettle(groupId: string) {
  return useQuery({
    queryKey: qk.groups.settle(groupId),
    queryFn: () => unwrap(api.GET('/groups/{groupId}/settle', { params: { path: { groupId } } })) as Promise<SettleView>,
  });
}

export function useReminderHistory(groupId: string, toMemberId: string | undefined) {
  return useQuery({
    queryKey: qk.groups.reminders(groupId, toMemberId),
    enabled: !!toMemberId,
    queryFn: () =>
      unwrap(
        api.GET('/groups/{groupId}/reminders', { params: { path: { groupId }, query: { toMemberId, limit: 10 } } }),
      ) as Promise<{ items: Reminder[]; nextCursor: string | null }>,
  });
}

/** Payments change balances everywhere: this group's detail tree (balances, expenses, settle), the list and the dashboard. */
function useRefreshAll(groupId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.groups.detail(groupId) }),
      qc.invalidateQueries({ queryKey: qk.groups.list() }),
      qc.invalidateQueries({ queryKey: qk.me.all }),
      qc.invalidateQueries({ queryKey: qk.activity.all }),
    ]);
}

function useRefreshReminders(groupId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: qk.groups.settle(groupId) }),
      qc.invalidateQueries({ queryKey: ['groups', groupId, 'reminders'] }),
      qc.invalidateQueries({ queryKey: qk.activity.all }),
    ]);
}

export interface RecordSettlementBody {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  currency?: string;
  method?: PayMethod | null;
}

export function useRecordSettlementMutation(groupId: string) {
  const refresh = useRefreshAll(groupId);
  return useMutation({
    mutationFn: ({ body, key }: { body: RecordSettlementBody; key: string }) =>
      unwrap(api.POST('/groups/{groupId}/settlements', { params: { path: { groupId } }, body, headers: { 'Idempotency-Key': key } })),
    onSuccess: refresh,
  });
}

export function useSettlementActionMutation(groupId: string, action: 'confirm' | 'reject') {
  const refresh = useRefreshAll(groupId);
  return useMutation({
    mutationFn: (settlementId: string) =>
      unwrap(
        api.POST(
          action === 'confirm'
            ? '/groups/{groupId}/settlements/{settlementId}/confirm'
            : '/groups/{groupId}/settlements/{settlementId}/reject',
          { params: { path: { groupId, settlementId } } },
        ),
      ),
    onSuccess: refresh,
  });
}

export function useUndoSettlementMutation(groupId: string) {
  const refresh = useRefreshAll(groupId);
  return useMutation({
    mutationFn: (settlementId: string) =>
      unwrap(api.DELETE('/groups/{groupId}/settlements/{settlementId}', { params: { path: { groupId, settlementId } } })),
    onSuccess: refresh,
  });
}

export interface SendReminderBody {
  toMemberId: string;
  tone: ReminderTone;
  channel: ReminderChannel;
  message?: string;
  autoRepeat: boolean;
}

export function useSendReminderMutation(groupId: string) {
  const refresh = useRefreshReminders(groupId);
  return useMutation({
    mutationFn: ({ body, key }: { body: SendReminderBody; key: string }) =>
      unwrap(
        api.POST('/groups/{groupId}/reminders', { params: { path: { groupId } }, body, headers: { 'Idempotency-Key': key } }),
      ) as Promise<Reminder>,
    // The panel words 429 (12 h cooldown) itself
    meta: { silent: true },
    onSuccess: refresh,
  });
}

export function useRemindAllMutation(groupId: string) {
  const refresh = useRefreshReminders(groupId);
  return useMutation({
    mutationFn: ({ body, key }: { body: Omit<SendReminderBody, 'toMemberId' | 'message'>; key: string }) =>
      unwrap(
        api.POST('/groups/{groupId}/reminders/all', { params: { path: { groupId } }, body, headers: { 'Idempotency-Key': key } }),
      ) as Promise<RemindAllResult>,
    onSuccess: refresh,
  });
}

export function useStopReminderMutation(groupId: string) {
  const refresh = useRefreshReminders(groupId);
  return useMutation({
    mutationFn: (reminderId: string) =>
      unwrap(api.POST('/groups/{groupId}/reminders/{reminderId}/stop', { params: { path: { groupId, reminderId } } })),
    onSuccess: refresh,
  });
}
