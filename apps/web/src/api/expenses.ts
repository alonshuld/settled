import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api';
import { qk } from './keys';

// The OpenAPI spec types the expense responses as `{}`; this mirrors ExpensesService.view in apps/api.

export type Category = 'food' | 'stay' | 'transport' | 'fuel' | 'shopping' | 'activities' | 'other';
export const CATEGORIES: readonly Category[] = ['food', 'stay', 'transport', 'fuel', 'shopping', 'activities', 'other'];

export type SplitMode = 'equal' | 'exact' | 'shares';

export interface ExpenseShare {
  memberId: string;
  /** Group base currency, minor units. Shares sum to the expense's `baseAmount`. */
  amount: number;
  originalAmount: number | null;
  shares: number | null;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  category: Category;
  /** In `currency`, minor units. */
  amount: number;
  currency: string;
  fxRate: string;
  fxSource: 'same' | 'market' | 'manual';
  fxDate: string | null;
  /** In the group's base currency. */
  baseAmount: number;
  paidByMemberId: string;
  /** `YYYY-MM-DD`. */
  date: string;
  hasReceipt: boolean;
  receiptKey: string | null;
  splitMode: SplitMode;
  shares: ExpenseShare[];
  createdByMemberId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpensePage {
  items: Expense[];
  nextCursor: string | null;
}

const PAGE = 30;

/** Newest first, cursor-paged. */
export function useExpenses(groupId: string) {
  return useInfiniteQuery({
    queryKey: qk.groups.expenses(groupId, { infinite: PAGE }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      unwrap(
        api.GET('/groups/{groupId}/expenses', {
          params: { path: { groupId }, query: { limit: PAGE, cursor: pageParam } },
        }),
      ) as Promise<ExpensePage>,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useDeleteExpenseMutation(groupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) =>
      unwrap(api.DELETE('/groups/{groupId}/expenses/{expenseId}', { params: { path: { groupId, expenseId } } })),
    // Balances, stats and the home cards all move with an expense.
    onSuccess: () =>
      qc
        .invalidateQueries({ queryKey: qk.groups.all })
        .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.me.all }), qc.invalidateQueries({ queryKey: qk.activity.all })])),
  });
}

/** One expense with a short-lived signed `receiptUrl` (null when the expense has no receipt or storage is off). */
export type ExpenseDetail = Expense & { receiptUrl?: string | null };

export function useExpense(groupId: string, expenseId: string | undefined) {
  return useQuery({
    queryKey: qk.groups.expense(groupId, expenseId ?? ''),
    queryFn: () =>
      unwrap(
        api.GET('/groups/{groupId}/expenses/{expenseId}', { params: { path: { groupId, expenseId: expenseId! } } }),
      ) as Promise<ExpenseDetail>,
    enabled: !!expenseId,
    // The form owns a draft of this; refetching underneath it would be surprising.
    staleTime: Infinity,
    gcTime: 0,
  });
}

type Paths = import('@settled/api-client').paths;
export type CreateExpenseBody = Paths['/groups/{groupId}/expenses']['post']['requestBody']['content']['application/json'];
export type UpdateExpenseBody = Paths['/groups/{groupId}/expenses/{expenseId}']['patch']['requestBody']['content']['application/json'];

/** Balances, stats, the activity feed and the home cards all move with an expense. */
function useRefreshAfterExpense() {
  const qc = useQueryClient();
  return () =>
    qc
      .invalidateQueries({ queryKey: qk.groups.all })
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.me.all }), qc.invalidateQueries({ queryKey: qk.activity.all })]));
}

/** The idempotency key is held by the caller per submit attempt (see ExpenseForm), as in NewGroupPage. */
export function useCreateExpenseMutation(groupId: string) {
  const refresh = useRefreshAfterExpense();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateExpenseBody; key: string }) =>
      unwrap(
        api.POST('/groups/{groupId}/expenses', { params: { path: { groupId } }, body, headers: { 'Idempotency-Key': key } }),
      ) as Promise<Expense>,
    // The form shows failures itself (with a retry), so the global toast stays out of the way.
    meta: { silent: true },
    onSuccess: refresh,
  });
}

export function useUpdateExpenseMutation(groupId: string, expenseId: string) {
  const refresh = useRefreshAfterExpense();
  return useMutation({
    mutationFn: (body: UpdateExpenseBody) =>
      unwrap(
        api.PATCH('/groups/{groupId}/expenses/{expenseId}', { params: { path: { groupId, expenseId } }, body }),
      ) as Promise<Expense>,
    meta: { silent: true },
    onSuccess: refresh,
  });
}
