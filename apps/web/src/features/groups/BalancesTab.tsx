import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { GroupBalances, GroupDetail } from '@/api/groupDetail';
import { CATEGORY_META } from '@/components/ui/CategoryIcon';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { barPercent, sharePercent } from '@/lib/expenses';
import { formatMoney, type Lang } from '@/lib/format';
import { TransfersCard } from './TransfersCard';
import { memberMap } from './members';

export function BalancesTab({ group, balances }: { group: GroupDetail; balances: UseQueryResult<GroupBalances> }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;

  if (balances.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3 p-2 pt-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-2xl" />
        ))}
      </div>
    );
  }
  if (balances.isError) {
    return <ErrorState bare error={balances.error} retrying={balances.isFetching} onRetry={() => void balances.refetch()} />;
  }

  const b = balances.data;
  const members = memberMap(group);
  const money = (n: number) => formatMoney(n, b.currency, lang);
  // Left members only matter while they still have a balance.
  const rows = b.members
    .map((bal) => ({ bal, m: members.get(bal.memberId) }))
    .filter((r) => r.m && (!r.m.leftAt || r.bal.net !== 0));
  const catTotal = b.byCategory.reduce((sum, c) => sum + c.amount, 0);

  const signed = (net: number) => (net === 0 ? t('group.settledLabel') : formatMoney(net, b.currency, lang, { signed: true }));

  return (
    <div className="flex flex-col gap-7 p-2 pt-4 md:p-2 md:py-4">
      <section aria-labelledby="bal-net" className="flex flex-col gap-3.5">
        <h3 id="bal-net" className="text-[15px] font-semibold">
          {t('group.netBalances')}
        </h3>

        <ul className="flex flex-col gap-2.5 md:hidden">
          {rows.map(({ bal, m }) => (
            <li key={bal.memberId} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3">
              <MemberAvatar name={m!.displayName} color={m!.color} size={38} />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="truncate text-[15px] font-medium">
                  {m!.displayName}
                  {m!.isMe && <span className="ms-1 text-muted">{t('group.you')}</span>}
                </span>
                <span aria-hidden="true" className="flex h-1.5 overflow-hidden rounded-full bg-surface2">
                  <span
                    style={{ width: `${barPercent(bal.net, b.members)}%` }}
                    className={bal.net > 0 ? 'rounded-full bg-pos' : 'rounded-full bg-neg'}
                  />
                </span>
              </span>
              <span className={`text-[15px] font-bold ${bal.net > 0 ? 'text-pos' : bal.net < 0 ? 'text-neg' : 'text-muted'}`}>
                {signed(bal.net)}
              </span>
            </li>
          ))}
        </ul>

        <ul className="hidden flex-col gap-3.5 md:flex">
          {rows.map(({ bal, m }) => (
            <li key={bal.memberId} className="grid grid-cols-[130px_minmax(0,1fr)_minmax(0,1fr)_96px] items-center">
              <span className="flex min-w-0 items-center gap-2.5 font-medium">
                <MemberAvatar name={m!.displayName} color={m!.color} size={30} />
                <span className="truncate">{m!.displayName}</span>
              </span>
              <span aria-hidden="true" className="flex h-7 justify-end border-e border-line">
                {bal.net < 0 && (
                  <span style={{ width: `${barPercent(bal.net, b.members)}%` }} className="rounded-s-lg bg-neg opacity-85" />
                )}
              </span>
              <span aria-hidden="true" className="flex h-7 justify-start">
                {bal.net > 0 && (
                  <span style={{ width: `${barPercent(bal.net, b.members)}%` }} className="rounded-e-lg bg-pos opacity-85" />
                )}
              </span>
              <span className={`text-end font-semibold ${bal.net > 0 ? 'text-pos' : bal.net < 0 ? 'text-neg' : 'text-muted'}`}>
                {signed(bal.net)}
              </span>
            </li>
          ))}
        </ul>
        <p className="hidden text-[13px] text-muted md:block">{t('group.barsNote')}</p>
      </section>

      <section aria-labelledby="bal-cat" className="flex flex-col gap-3.5">
        <h3 id="bal-cat" className="text-[15px] font-semibold">
          {t('group.byCategory')}
        </h3>
        {b.byCategory.length === 0 ? (
          <p className="text-sm text-muted">{t('group.noCategories')}</p>
        ) : (
          <>
            <div aria-hidden="true" className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
              {b.byCategory.map((c) => (
                <span
                  key={c.category}
                  style={{ width: `${sharePercent(c.amount, catTotal)}%`, background: CATEGORY_META[c.category]?.color }}
                />
              ))}
            </div>
            <ul className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2.5">
              {b.byCategory.map((c) => (
                <li key={c.category} className="flex items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    style={{ background: CATEGORY_META[c.category]?.color }}
                    className="size-2.5 flex-none rounded-[3px]"
                  />
                  {t(`group.categories.${c.category}`)}
                  <span className="ms-auto text-muted">{money(c.amount)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="md:hidden">
        <TransfersCard group={group} balances={balances} />
      </div>
    </div>
  );
}
