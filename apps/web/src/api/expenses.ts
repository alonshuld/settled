import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups.all }).then(() => qc.invalidateQueries({ queryKey: qk.me.all })),
  });
}
