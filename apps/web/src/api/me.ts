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
