import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Expense } from '@/api/expenses';
import type { GroupDetail } from '@/api/groupDetail';
import { memberMap } from './members';

export function useSplitLabel() {
  const { t } = useTranslation();
  return (e: Pick<Expense, 'splitMode' | 'shares'>) =>
    e.splitMode === 'equal'
      ? t('group.splitEqual', { count: e.shares.length })
      : e.splitMode === 'exact'
        ? t('group.splitExact')
        : t('group.splitShares');
}

/** "Itay paid · split 4 ways" / "You paid · exact amounts". */
export function useExpenseMeta(group: GroupDetail) {
  const { t } = useTranslation();
  const members = useMemo(() => memberMap(group), [group]);
  const split = useSplitLabel();
  return (e: Expense) => {
    const payer = members.get(e.paidByMemberId);
    const paid = payer?.isMe ? t('group.youPaid') : t('group.paidBy', { name: payer?.displayName ?? '' });
    return `${paid} · ${split(e)}`;
  };
}
