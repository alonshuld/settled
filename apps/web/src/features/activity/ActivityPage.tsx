import { Bell } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  useActivityCounts,
  useActivityFeed,
  useMarkAllReadMutation,
  useMyStats,
  type ActivityFilter,
  type ActivityItem,
} from '@/api/activity';
import { Button, buttonClass } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { groupByDay, latestReminderToMe } from '@/lib/activityText';
import { formatDate, formatMoney, type Lang } from '@/lib/format';
import { ActivityRow } from './ActivityRow';

const FILTERS: ActivityFilter[] = ['all', 'expense', 'payment', 'reminder', 'member'];
const card = 'rounded-card border border-line bg-surface';

export function Component() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [params, setParams] = useSearchParams();
  const raw = params.get('type');
  const filter = FILTERS.includes(raw as ActivityFilter) ? (raw as ActivityFilter) : 'all';
  const feed = useActivityFeed(filter);
  const counts = useActivityCounts();
  const markRead = useMarkAllReadMutation();

  const items = useMemo(() => feed.data?.pages.flatMap((p) => p.items) ?? [], [feed.data]);
  const sections = useMemo(() => groupByDay(items, new Date()), [items]);
  const reminder = filter === 'all' || filter === 'reminder' ? latestReminderToMe(items) : undefined;
  const unread = counts.data?.unread ?? 0;

  return (
    <div className="mx-auto flex max-w-300 flex-col gap-5 px-5 pt-6 pb-10 md:gap-6 md:px-8 md:pt-10 md:pb-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] font-bold tracking-tight md:text-4xl">{t('activity.title')}</h1>
          <span className="text-muted md:text-base">{t('activity.sub')}</span>
        </div>
        <Button variant="ghost" loading={markRead.isPending} disabled={unread === 0} onClick={() => markRead.mutate()}>
          {t('activity.markRead')}
        </Button>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <section className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          <div role="group" aria-label={t('activity.filtersLabel')} className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const on = f === filter;
              return (
                <button
                  key={f}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setParams(f === 'all' ? {} : { type: f }, { replace: true })}
                  className={cn(
                    'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-4 text-sm font-medium',
                    on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface text-ink hover:border-muted',
                  )}
                >
                  {t(`activity.filters.${f}`)}
                  {counts.data && <span className="text-xs opacity-70">{counts.data[f]}</span>}
                </button>
              );
            })}
          </div>

          <div className={cn(card, 'p-2 md:px-3')}>
            {feed.isPending ? (
              <FeedSkeleton />
            ) : feed.isError ? (
              <ErrorState bare error={feed.error} retrying={feed.isFetching} onRetry={() => void feed.refetch()} />
            ) : sections.length === 0 ? (
              <EmptyState bare icon={Bell} title={t(filter === 'all' ? 'activity.empty' : 'activity.emptyFiltered')} />
            ) : (
              <>
                {sections.map((s) => (
                  <div key={s.section} className="flex flex-col">
                    <h2 className="px-4 pt-4 pb-1 text-[13px] font-semibold tracking-wide text-muted">
                      {t(`activity.sections.${s.section}`)}
                    </h2>
                    <ul className="flex flex-col">
                      {s.items.map((it) => (
                        <ActivityRow key={it.id} item={it} section={s.section} />
                      ))}
                    </ul>
                  </div>
                ))}
                {feed.hasNextPage && (
                  <div className="flex justify-center p-3">
                    <Button variant="ghost" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                      {t('activity.loadMore')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        <aside className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {reminder && <ReminderCard item={reminder} lang={lang} />}
          <MonthStats lang={lang} />
        </aside>
      </div>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-1 p-2">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-3.5 p-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-4 w-4/5 rounded" />
            <Skeleton className="h-3 w-2/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ReminderCard({ item, lang }: { item: ActivityItem; lang: Lang }) {
  const { t } = useTranslation();
  const p = item.payload ?? {};
  const amount = typeof p.amount === 'number' && typeof p.currency === 'string' ? formatMoney(p.amount, p.currency, lang) : '';
  const creditor = typeof p.creditorName === 'string' ? p.creditorName : '';
  const message = typeof p.message === 'string' ? p.message : '';
  const to = `/groups/${item.groupId}/settle`;
  return (
    <section aria-label={t('activity.gotReminder')} className="flex flex-col gap-3.5 rounded-card bg-neg-bg p-5.5">
      <div className="flex items-center gap-2.5 font-semibold text-neg">
        <Bell size={18} aria-hidden="true" />
        {t('activity.gotReminder')}
      </div>
      <p className="leading-normal wrap-anywhere whitespace-pre-line line-clamp-5">
        {creditor && <strong className="font-semibold">{creditor}: </strong>}
        {message || t('activity.ev.reminder.received', { creditor, amount })}
      </p>
      <span className="text-[13px] text-muted">{item.groupName}</span>
      <div className="flex flex-wrap gap-2">
        <Link to={to} className={buttonClass('primary')}>
          {amount ? t('activity.payNow', { amount }) : t('activity.payNow', { amount: '' }).trim()}
        </Link>
        <Link to={to} className={buttonClass('ghost')}>
          {t('activity.paidAlready')}
        </Link>
      </div>
    </section>
  );
}

function MonthStats({ lang }: { lang: Lang }) {
  const { t } = useTranslation();
  const q = useMyStats();
  const month = formatDate(new Date(), lang, { month: 'long' });
  const rows = q.data?.perCurrency ?? [];
  const multi = rows.length > 1;
  return (
    <section aria-labelledby="stats-h" className={cn(card, 'flex flex-col gap-3 p-5.5')}>
      <h2 id="stats-h" className="text-[17px] font-semibold">
        {t('activity.thisMonth', { month })}
      </h2>
      {q.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton className="h-5 rounded" />
          <Skeleton className="h-5 rounded" />
          <Skeleton className="h-5 rounded" />
        </div>
      ) : q.isError ? (
        <ErrorState bare error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />
      ) : (
        <>
          {rows.length === 0 && <p className="text-sm text-muted">{t('activity.statsEmpty')}</p>}
          {rows.map((r) => (
            <div key={r.currency} className="flex flex-col gap-3">
              {multi && <span className="text-[13px] font-semibold text-muted">{r.currency}</span>}
              <Stat label={t('activity.spentGroups')} value={formatMoney(r.myShareOfExpenses, r.currency, lang)} />
              <Stat label={t('activity.received')} value={formatMoney(r.paidBackToMe, r.currency, lang)} tone="text-pos" />
            </div>
          ))}
          <Stat label={t('activity.remindersSent')} value={String(q.data.remindersSent)} />
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span dir="ltr" className={cn('font-semibold', tone)}>
        {value}
      </span>
    </div>
  );
}
