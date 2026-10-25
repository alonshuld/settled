import { Bell, Link2, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useRecentActivity } from '@/api/activity';
import { useDashboard, type AttentionItem, type CurrencyTotal, type Dashboard, type GroupCard } from '@/api/groups';
import { buttonClass } from '@/components/ui/Button';
import { GroupAvatarStack, MemberAvatar } from '@/components/ui/MemberAvatar';
import { GroupTypeIcon } from '@/components/ui/GroupTypeIcon';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { ActivityRow } from '@/features/activity/ActivityRow';
import { HomeLoadingBody } from '@/features/shell/HomeLoading';
import { useSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { formatDate, formatDateRange, formatMoney, type Lang } from '@/lib/format';

const card = 'rounded-card border border-line bg-surface';

function useLang() {
  const { i18n } = useTranslation();
  return i18n.language as Lang;
}

export function Component() {
  const { t } = useTranslation();
  const lang = useLang();
  const { data: session } = useSession();
  const q = useDashboard();
  const first = (session?.user.name ?? '').trim().split(/\s+/)[0] ?? '';

  if (q.isPending) return <HomeLoadingBody />;
  if (q.isError) {
    return (
      <div className="mx-auto max-w-7xl px-5 pt-8 md:px-8 md:pt-10">
        <ErrorState error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />
      </div>
    );
  }

  const d = q.data;
  const empty = d.groups.length === 0;
  const active = d.groups.filter((g) => !g.closedAt).length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4.5 px-5 pt-6 pb-10 md:gap-8 md:px-8 md:pt-10 md:pb-14">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div className="flex flex-col gap-0.5 md:gap-1.5">
          <span className="text-[13px] text-muted md:text-[15px]">
            {formatDate(new Date(), lang, { weekday: 'long', day: 'numeric', month: 'long' })}
          </span>
          <h1 className="text-[26px] font-bold tracking-tight md:text-[40px]">
            {first ? t('home.hello', { name: first }) : t('home.helloAnon')}
          </h1>
        </div>
        <div className="hidden gap-2.5 md:flex">
          <Link to="/j" className={buttonClass('ghost')}>
            <Link2 size={18} aria-hidden="true" />
            {t('home.join')}
          </Link>
          <Link to="/groups/new" className={buttonClass('primary')}>
            <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
            {t('home.newGroup')}
          </Link>
        </div>
      </div>

      {empty ? (
        <EmptyState
          icon={Users}
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={
            <>
              <Link to="/groups/new" className={buttonClass('primary')}>
                <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
                {t('home.newGroup')}
              </Link>
              <Link to="/j" className={buttonClass('ghost')}>
                <Link2 size={18} aria-hidden="true" />
                {t('home.join')}
              </Link>
            </>
          }
        />
      ) : (
        <>
          <Hero data={d} lang={lang} />
          <Attention items={d.needsAttention} lang={lang} limit={1} className="md:hidden" />

          <div className="flex flex-wrap items-start gap-7">
            <section aria-labelledby="groups-h" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5 md:gap-4">
              <div className="flex items-center justify-between gap-3">
                <h2 id="groups-h" className="text-lg font-semibold md:text-[22px]">
                  {t('home.groups')}
                </h2>
                <span className="hidden text-sm text-muted md:inline">{t('home.activeCount', { count: active })}</span>
                <Link to="/j" className="inline-flex min-h-11 items-center text-sm font-semibold md:hidden">
                  {t('home.join')}
                </Link>
              </div>
              <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] md:gap-4">
                {d.groups.map((g) => (
                  <li key={g.id} className="contents">
                    <GroupCardView group={g} lang={lang} />
                  </li>
                ))}
                <li className="hidden md:contents">
                  <Link
                    to="/groups/new"
                    className="flex min-h-55 flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-line text-muted hover:border-muted"
                  >
                    <span className="inline-flex size-12 items-center justify-center rounded-full bg-surface2 text-ink">
                      <Plus size={22} aria-hidden="true" />
                    </span>
                    <span className="font-semibold text-ink">{t('home.newGroupCard')}</span>
                    <span className="text-sm">{t('home.newGroupHint')}</span>
                  </Link>
                </li>
              </ul>
            </section>

            <aside className="hidden min-w-0 flex-[1_1_320px] flex-col gap-4 md:flex">
              <Attention items={d.needsAttention} lang={lang} />
              <RecentActivity />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function totalFor(d: Dashboard): CurrencyTotal | undefined {
  return d.totals.find((x) => x.currency === d.overall.currency);
}

function Hero({ data, lang }: { data: Dashboard; lang: Lang }) {
  const { t } = useTranslation();
  const { overall } = data;
  const own = totalFor(data);
  const money = (n: number, signed?: boolean) => formatMoney(n, overall.currency, lang, { signed });
  const net = overall.net;
  const approx = overall.approximate ? '≈ ' : '';

  const owedSub =
    overall.owedToMe > 0 && own && own.owedToMe > 0
      ? `${t('home.fromPeople', { count: own.owedByPeople })} ${t('home.inGroups', { count: own.owedInGroups })}`
      : t('home.nobodyOwes');
  const oweSub =
    overall.iOwe > 0 && own && own.iOwe > 0
      ? `${t('home.toPeople', { count: own.oweToPeople })} ${t('home.inGroups', { count: own.oweInGroups })}`
      : t('home.youOweNobody');
  const netSub = net > 0 ? t('home.netSubPos') : net < 0 ? t('home.netSubNeg') : t('home.netSubZero');

  return (
    <section aria-label={t('home.net')} className="flex flex-col gap-2">
      {/* Phone: one dark hero with two chips. Desktop: three cards (the hero stays dark in both themes). */}
      <div className="flex flex-col gap-3.5 rounded-3xl border border-hero-line bg-hero p-5 text-[#f2f3f5] md:hidden">
        <span className="text-sm text-hero-muted">{t('home.netShort')}</span>
        <span className="text-[40px] font-bold tracking-tight text-accent">
          {approx}
          {money(net, true)}
        </span>
        <div className="flex gap-2.5">
          <span className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-[#1c2128] px-3 py-2.5">
            <span className="text-xs text-hero-muted">{t('home.owedToYou')}</span>
            <span className="font-semibold text-[#4bdb98]">
              {money(overall.owedToMe)}
            </span>
          </span>
          <span className="flex flex-1 flex-col gap-0.5 rounded-[14px] bg-[#1c2128] px-3 py-2.5">
            <span className="text-xs text-hero-muted">{t('home.youOwe')}</span>
            <span className="font-semibold text-[#ff9568]">
              {money(overall.iOwe)}
            </span>
          </span>
        </div>
      </div>

      <div className="hidden grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 md:grid">
        <div className="flex flex-col gap-3.5 rounded-card border border-hero-line bg-hero p-6 text-[#f2f3f5]">
          <span className="text-[15px] text-hero-muted">{t('home.net')}</span>
          <span className="text-[44px] leading-tight font-bold tracking-tight text-accent">
            {approx}
            {money(net, true)}
          </span>
          <span className="text-sm text-hero-muted">{netSub}</span>
        </div>
        <div className={cn(card, 'flex flex-col gap-3.5 p-6')}>
          <span className="flex items-center gap-2 text-[15px] text-muted">
            <span aria-hidden="true" className="size-2 rounded-full bg-pos" />
            {t('home.owedToYou')}
          </span>
          <span className="text-4xl font-bold text-pos">
            {approx}
            {money(overall.owedToMe)}
          </span>
          <span className="text-sm text-muted">{owedSub}</span>
        </div>
        <div className={cn(card, 'flex flex-col gap-3.5 p-6')}>
          <span className="flex items-center gap-2 text-[15px] text-muted">
            <span aria-hidden="true" className="size-2 rounded-xs bg-neg" />
            {t('home.youOwe')}
          </span>
          <span className="text-4xl font-bold text-neg">
            {approx}
            {money(overall.iOwe)}
          </span>
          <span className="text-sm text-muted">{oweSub}</span>
        </div>
      </div>

      {overall.approximate && <p className="text-[13px] text-muted">{t('home.approx')}</p>}
      {overall.excludedCurrencies.length > 0 && (
        <p className="text-[13px] text-muted">{t('home.excluded', { list: overall.excludedCurrencies.join(', ') })}</p>
      )}
    </section>
  );
}

function GroupCardView({ group: g, lang }: { group: GroupCard; lang: Lang }) {
  const { t } = useTranslation();
  const dates = formatDateRange(g.startDate, g.endDate, lang);
  const meta = [g.closedAt ? t('home.closed') : null, dates, t('home.members', { count: g.memberCount })]
    .filter(Boolean)
    .join(' · ');
  const owed = g.myNet > 0;
  const owe = g.myNet < 0;
  const label = owed ? t('home.owedShort') : owe ? t('home.oweShort') : '';
  const amount = formatMoney(Math.abs(g.myNet), g.currency, lang);
  const tone = owed ? 'text-pos' : owe ? 'text-neg' : 'text-muted';

  return (
    <Link
      to={`/groups/${g.id}`}
      className="group flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5 hover:border-muted md:flex-col md:items-stretch md:gap-4.5 md:rounded-card md:p-5.5"
    >
      <span className="flex min-w-0 flex-1 items-center gap-3 md:flex-none md:gap-3.5">
        <GroupTypeIcon type={g.type} size={44} className="md:hidden" />
        <GroupTypeIcon type={g.type} size={48} className="max-md:hidden" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-base font-semibold md:text-lg">{g.name}</span>
          <span className="truncate text-[13px] text-muted md:text-sm">{meta}</span>
        </span>
      </span>

      <span className="hidden md:flex">
        <GroupAvatarStack total={g.memberCount} size={32} />
      </span>

      <span className="flex flex-col items-end gap-px md:flex-row md:items-center md:justify-between md:gap-3 md:border-t md:border-line md:pt-4">
        {g.settled || (!owed && !owe) ? (
          g.settled ? (
            <span className="inline-flex -rotate-6 items-center gap-1.5 rounded-[10px] border-2 border-pos px-2.5 py-0.5 text-sm font-extrabold text-pos md:px-3 md:text-base">
              {t('home.stamp')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : (
            <span className="text-sm font-medium text-muted">{t('home.even')}</span>
          )
        ) : (
          <span className="flex flex-col items-end gap-0.5 md:items-start">
            <span className="text-[11px] text-muted md:text-[13px]">{label}</span>
            <span className={cn('text-base font-bold md:text-xl', tone)}>
              {amount}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}

function Attention({
  items,
  lang,
  limit,
  className,
}: {
  items: AttentionItem[];
  lang: Lang;
  limit?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const compact = limit !== undefined;
  const shown = compact ? items.slice(0, limit) : items;
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby={compact ? undefined : 'attn-h'} className={cn(compact ? 'flex flex-col gap-2.5' : `${card} flex flex-col gap-4 p-5.5`, className)}>
      {!compact && (
        <h2 id="attn-h" className="text-lg font-semibold">
          {t('home.waiting')}
        </h2>
      )}
      {shown.map((a, i) => {
        const owe = a.kind === 'iOwe';
        const amount = formatMoney(a.amount, a.currency, lang);
        return (
          <div
            key={`${a.groupId}:${a.memberId}:${a.kind}`}
            className={cn('flex items-center gap-3 rounded-[18px] p-3.5 md:rounded-[14px]', owe ? 'bg-neg-bg' : 'bg-surface2')}
          >
            <MemberAvatar name={a.name} index={i + 1} size={40} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold">
                {owe ? t('home.payTo', { name: a.name, amount }) : t('home.owesYou', { name: a.name, amount })}
              </span>
              <span className="truncate text-[13px] text-muted">{a.groupName}</span>
            </div>
            <Link
              to={`/groups/${a.groupId}/settle`}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-control px-3.5 text-sm font-semibold',
                owe ? 'bg-accent text-accent-ink hover:brightness-95' : 'border border-line bg-surface hover:bg-surface2',
              )}
            >
              {!owe && <Bell size={16} aria-hidden="true" />}
              {owe ? t('home.pay') : t('home.remind')}
            </Link>
          </div>
        );
      })}
    </section>
  );
}

function RecentActivity() {
  const { t } = useTranslation();
  const q = useRecentActivity(5);
  return (
    <section aria-labelledby="recent-h" className={`${card} flex flex-col gap-2 p-4`}>
      <div className="flex items-center justify-between gap-3 px-1.5 pt-1.5">
        <h2 id="recent-h" className="text-lg font-semibold">
          {t('activity.recent')}
        </h2>
        <Link to="/activity" className="inline-flex min-h-11 items-center text-sm font-semibold">
          {t('activity.seeAll')}
        </Link>
      </div>
      {q.isPending ? (
        <Skeleton className="mx-1.5 mb-2 h-32 rounded-[14px]" />
      ) : q.isError || q.data.items.length === 0 ? (
        <p className="px-1.5 pb-2 text-sm text-muted">{t('activity.recentEmpty')}</p>
      ) : (
        <ul className="flex flex-col">
          {q.data.items.map((it) => (
            <ActivityRow key={it.id} item={it} section="compact" compact />
          ))}
        </ul>
      )}
    </section>
  );
}
