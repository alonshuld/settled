import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaymentDetails } from '@settled/core';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

// GET/PUT /me/payment-details are typed `{}` in the OpenAPI spec; fields are nullable strings (PUT replaces the record).
export type MyPaymentDetails = Required<{ [K in keyof PaymentDetails]: string | null }>;

export function usePaymentDetails() {
  return useQuery({
    queryKey: qk.me.paymentDetails(),
    queryFn: () => unwrap(api.GET('/me/payment-details')) as Promise<MyPaymentDetails>,
  });
}

export function usePutPaymentDetailsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MyPaymentDetails) => unwrap(api.PUT('/me/payment-details', { body })) as Promise<MyPaymentDetails>,
    onSuccess: async (data) => {
      qc.setQueryData(qk.me.paymentDetails(), data);
      // Settle views echo the caller's details and the pay options other people see
      await qc.invalidateQueries({ queryKey: ['groups'], predicate: (q) => q.queryKey[2] === 'settle' });
    },
  });
}

// GET /me and the notification-prefs endpoints are typed `{}` in the spec; shapes follow apps/api me.service.ts.
export interface NotificationPrefs {
  remindersToMe: boolean;
  newExpenses: boolean;
  paymentsReceived: boolean;
  weeklySummary: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string | null;
  contactPhone: string | null;
  image: string | null;
  locale: 'he' | 'en';
  theme: 'light' | 'dark' | 'system';
  defaultCurrency: string;
  gender: 'male' | 'female' | null;
  isGuest: boolean;
  methods: { google: boolean; email: boolean; phone: boolean };
  notificationPrefs: NotificationPrefs;
}

export type MePatch = Partial<Pick<Me, 'name' | 'locale' | 'theme' | 'defaultCurrency'>>;

export function useMe() {
  return useQuery({
    queryKey: qk.me.profile(),
    queryFn: () => unwrap(api.GET('/me')) as Promise<Me>,
  });
}

/** `silent`: appearance changes already took effect locally, a failed sync should not shout. */
export function useUpdateMeMutation(opts: { silent?: boolean } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: MePatch) => unwrap(api.PATCH('/me', { body })) as Promise<Me>,
    meta: { silent: opts.silent },
    onSuccess: (me) => {
      qc.setQueryData(qk.me.profile(), me);
      // Home greets by name / formats totals in the default currency
      void qc.invalidateQueries({ queryKey: qk.me.dashboard() });
    },
  });
}

export function useNotificationPrefs() {
  return useQuery({
    queryKey: qk.me.prefs(),
    queryFn: () => unwrap(api.GET('/me/notification-prefs')) as Promise<NotificationPrefs>,
  });
}

export function usePatchPrefsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<NotificationPrefs>) =>
      unwrap(api.PATCH('/me/notification-prefs', { body })) as Promise<NotificationPrefs>,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.me.prefs() });
      const prev = qc.getQueryData<NotificationPrefs>(qk.me.prefs());
      if (prev) qc.setQueryData(qk.me.prefs(), { ...prev, ...patch });
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.me.prefs(), ctx.prev);
    },
    onSuccess: (data) => qc.setQueryData(qk.me.prefs(), data),
  });
}

export type WebPushBody = { kind: 'webpush'; endpoint: string; keys: { p256dh: string; auth: string } };

export function useAddPushMutation() {
  return useMutation({
    mutationFn: (body: WebPushBody) => unwrap(api.POST('/me/push-subscriptions', { body })) as Promise<{ id: string }>,
  });
}

export function useRemovePushMutation() {
  return useMutation({
    mutationFn: (id: string) => unwrap(api.DELETE('/me/push-subscriptions/{id}', { params: { path: { id } } })),
  });
}

export function useDeleteAccountMutation() {
  return useMutation({
    mutationFn: () => unwrap(api.DELETE('/me', { body: { confirm: 'DELETE' } })),
  });
}
