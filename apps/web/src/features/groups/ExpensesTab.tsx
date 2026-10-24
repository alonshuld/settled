import { Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useExpenses, type Expense } from '@/api/expenses';
import type { GroupDetail } from '@/api/groupDetail';
import { Button, buttonClass } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { effectFor, groupByDay } from '@/lib/expenses';
import { formatDate, formatMoney, type Lang } from '@/lib/format';
import { ExpenseSheet } from './ExpenseSheet';
import { useExpenseMeta } from './expenseLabels';

export function ExpensesTab({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const q = useExpenses(group.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const meta = useExpenseMeta(group);
  const me = group.members.find((m) => m.isMe)?.id;

  const items = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const days = useMemo(() => groupByDay(items), [items]);
  const open = items.find((e) => e.id === openId) ?? null;

  if (q.isPending) return <ListSkeleton />;
  if (q.isError) return <ErrorState bare error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />;

  if (items.length === 0) {
    return (
      <EmptyState
        bare
        icon={Receipt}
        title={t('group.emptyTitle')}
        body={t('group.emptyBody')}
        action={
          !group.closedAt && (
            <Link to={`/groups/${group.id}/expenses/new`} className={buttonClass('primary')}>
              {t('group.add')}
            </Link>
          )
        }
      />
    );
  }

  return (
    <div className="flex flex-col">
      {days.map((day) => (
        <section key={day.date} aria-label={formatDate(day.date, lang, { dateStyle: 'full' })} className="flex flex-col">
          <h3 className="px-2 pt-4 pb-1.5 text-xs font-semibold tracking-wide text-muted uppercase md:px-4 md:text-[13px]">
            {formatDate(day.date, lang, { weekday: 'short', day: 'numeric', month: 'short' })}
          </h3>
          <ul className="flex flex-col">
            {day.items.map((e) => {
              const eff = effectFor(e, me);
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setOpenId(e.id)}
                    className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-[14px] px-2 py-2.5 text-start hover:bg-surface2 md:gap-3.5 md:px-4 md:py-3.5"
                  >
                    <span className="md:hidden">
                      <CategoryIcon category={e.category} size={40} />
                    </span>
                    <span className="hidden md:inline-flex">
                      <CategoryIcon category={e.category} size={44} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-semibold md:text-base">{e.description}</span>
                      <span className="truncate text-xs text-muted md:text-sm">{meta(e)}</span>
                    </span>
                    <span className="flex flex-none flex-col items-end gap-0.5">
                      <span className="text-[15px] font-semibold md:text-[17px]">
                        {formatMoney(e.amount, e.currency, lang)}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-medium md:text-[13px]',
                          eff.kind === 'lent' ? 'text-pos' : eff.kind === 'borrowed' ? 'text-neg' : 'text-muted',
                        )}
                      >
                        {eff.kind === 'lent'
                          ? t('group.lent', { amount: formatMoney(eff.amount, group.currency, lang) })
                          : eff.kind === 'borrowed'
                            ? t('group.borrowed', { amount: formatMoney(eff.amount, group.currency, lang) })
                            : t('group.notInvolved')}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {q.hasNextPage && (
        <div className="flex justify-center pt-4">
          <Button variant="ghost" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
            {t('group.loadMore')}
          </Button>
        </div>
      )}

      <ExpenseSheet
        group={group}
        expense={open}
        open={open !== null}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2 pt-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="size-10 rounded-xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}
