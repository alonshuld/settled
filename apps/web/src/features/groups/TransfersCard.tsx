import type { UseQueryResult } from '@tanstack/react-query';
import { Bell, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { GroupBalances, GroupDetail } from '@/api/groupDetail';
import { buttonClass } from '@/components/ui/Button';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { formatMoney, type Lang } from '@/lib/format';
import { memberMap } from './members';

/** "Who owes whom": the simplified transfers from `@settled/core`, computed by the API. */
export function TransfersCard({ group, balances }: { group: GroupDetail; balances: UseQueryResult<GroupBalances> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const members = memberMap(group);
  const settleTo = `/groups/${group.id}/settle`;

  let body;
  if (balances.isPending) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-2.5">
        <Skeleton className="h-16 rounded-[14px]" />
        <Skeleton className="h-16 rounded-[14px]" />
      </div>
    );
  } else if (balances.isError) {
    body = <ErrorState bare error={balances.error} retrying={balances.isFetching} onRetry={() => void balances.refetch()} />;
  } else {
    const { transfers } = balances.data;
    const owedToMe = transfers.some((x) => members.get(x.toMemberId)?.isMe);
    body =
      transfers.length === 0 ? (
        <div className="flex items-center gap-3 rounded-[14px] bg-pos-bg p-3.5 text-pos">
          <Check size={22} strokeWidth={3} aria-hidden="true" />
          <span className="flex flex-col">
            <span className="font-semibold">{t('group.settledTitle')}</span>
            <span className="text-sm">{t('group.settledBody')}</span>
          </span>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {transfers.map((x) => {
              const from = members.get(x.fromMemberId);
              const to = members.get(x.toMemberId);
              const iOwe = !!from?.isMe;
              const owedMe = !!to?.isMe;
              const other = iOwe ? to : from;
              const text = owedMe
                ? t('group.owesYou', { name: from?.displayName })
                : iOwe
                  ? t('group.youOwe', { name: to?.displayName })
                  : t('group.owes', { from: from?.displayName, to: to?.displayName });
              return (
                <li key={`${x.fromMemberId}:${x.toMemberId}`} className="flex items-center gap-2.5 rounded-[14px] bg-surface2 p-3">
                  <MemberAvatar name={other?.displayName} color={other?.color} size={34} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-medium">{text}</span>
                    <span className="text-lg font-bold">{formatMoney(x.amount, group.currency, lang)}</span>
                  </span>
                  {(owedMe || iOwe) && !group.closedAt && (
                    <Link to={settleTo} className={buttonClass('ghost')}>
                      {owedMe && <Bell size={16} aria-hidden="true" />}
                      {owedMe ? t('group.remind') : t('group.pay')}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {owedToMe && !group.closedAt && (
            <Link to={settleTo} className={buttonClass('primary', undefined, 'lg')}>
              {t('group.remindAll')}
            </Link>
          )}
        </>
      );
  }

  return (
    <section aria-labelledby="transfers-h" className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5.5 max-md:border-0 max-md:bg-transparent max-md:p-0">
      <div className="flex flex-col gap-1">
        <h2 id="transfers-h" className="text-lg font-semibold">
          {t('group.whoOwes')}
        </h2>
        {balances.data && balances.data.transfers.length > 0 && (
          <span className="text-sm text-muted">
            {t('group.simplified', { count: balances.data.transfers.length, expenses: balances.data.expenseCount })}
          </span>
        )}
      </div>
      {body}
    </section>
  );
}
