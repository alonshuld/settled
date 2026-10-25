import { ChevronLeft, ArrowLeftRight, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useGroup, useGroupBalances, type GroupDetail } from '@/api/groupDetail';
import { Button, buttonClass, IconButton } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Dialog';
import { GroupTypeIcon } from '@/components/ui/GroupTypeIcon';
import { GroupAvatarStack } from '@/components/ui/MemberAvatar';
import { Stamp } from '@/components/ui/Stamp';
import { ErrorState } from '@/components/ui/States';
import { cn } from '@/lib/cn';
import { errorCode } from '@/lib/errors';
import { formatDateRange, formatMoney, type Lang } from '@/lib/format';
import { BalancesTab } from './BalancesTab';
import { ExpensesTab } from './ExpensesTab';
import { GroupSkeleton } from './GroupSkeleton';
import { InviteCard, InviteDialog } from './InviteDialog';
import { MembersPanel } from './MembersPanel';
import { TransfersCard } from './TransfersCard';
import { activeMembers } from './members';

type Tab = 'expenses' | 'balances';

export function Component() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const q = useGroup(id);

  if (q.isPending) return <GroupSkeleton />;
  if (q.isError) {
    const missing = errorCode(q.error) === 'NOT_FOUND' || errorCode(q.error) === 'NOT_A_MEMBER';
    return (
      <div className="mx-auto max-w-7xl px-5 pt-8 md:px-8 md:pt-10">
        <ErrorState
          error={q.error}
          title={missing ? t('group.notFoundTitle') : undefined}
          retrying={q.isFetching}
          onRetry={missing ? undefined : () => void q.refetch()}
          action={
            <Link to="/" className={buttonClass('ghost')}>
              {t('group.back')}
            </Link>
          }
        />
      </div>
    );
  }
  return <GroupView group={q.data} />;
}

function GroupView({ group }: { group: GroupDetail }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const [tab, setTab] = useState<Tab>('expenses');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const balances = useGroupBalances(group.id);

  const closed = !!group.closedAt;
  const members = activeMembers(group);
  const allPaid = group.expenseCount > 0 && balances.data?.transfers.length === 0;
  const settled = closed || allPaid;
  const money = (n: number) => formatMoney(n, group.currency, lang);
  const meta = [formatDateRange(group.startDate, group.endDate, lang), t('home.members', { count: members.length })]
    .filter(Boolean)
    .join(' · ');
  const net = group.stats.myNet;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pt-3 pb-10 md:gap-6 md:px-8 md:pt-6 md:pb-14">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          aria-label={t('group.back')}
          className="inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-control font-medium text-muted hover:text-ink md:pe-2"
        >
          <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden="true" />
          <span className="hidden md:inline">{t('group.back')}</span>
        </Link>
        <div className="flex-1" />
        <IconButton aria-label={t('group.membersBtn')} className="md:hidden" onClick={() => setMembersOpen(true)}>
          <Users size={19} aria-hidden="true" />
        </IconButton>
        <IconButton aria-label={t('group.inviteFriends')} className="md:hidden" onClick={() => setInviteOpen(true)}>
          <UserPlus size={19} aria-hidden="true" />
        </IconButton>
      </div>

      <section className="flex flex-wrap items-center gap-3.5 md:gap-5">
        <GroupTypeIcon type={group.type} size={56} className="md:hidden" />
        <GroupTypeIcon type={group.type} size={72} className="max-md:hidden" />
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1 md:gap-2">
          <h1 className="text-[26px] font-bold tracking-tight break-words md:text-4xl">{group.name}</h1>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted md:text-[15px]">
            <span>{meta}</span>
            <span className="max-md:hidden">
              <GroupAvatarStack members={members.map((m) => ({ name: m.displayName, color: m.color }))} size={28} />
            </span>
          </div>
        </div>
        {settled && (
          <Stamp
            iconSize={22}
            className="border-pos px-3.5 py-1 text-xl text-pos animate-stamp-in md:text-2xl"
          >
            {t('group.stamp')}
          </Stamp>
        )}
        <div className="hidden flex-wrap gap-2.5 md:flex">
          <Button variant="ghost" onClick={() => setInviteOpen(true)}>
            <UserPlus size={18} aria-hidden="true" />
            {t('group.invite')}
          </Button>
          <Link to={`/groups/${group.id}/settle`} className={buttonClass('ghost')}>
            <ArrowLeftRight size={18} aria-hidden="true" />
            {t('group.settle')}
          </Link>
          {!closed && (
            <Link to={`/groups/${group.id}/expenses/new`} className={buttonClass('primary')}>
              <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
              {t('group.add')}
            </Link>
          )}
        </div>
      </section>

      {closed && (
        <p role="status" className="rounded-control bg-warn-bg px-4 py-3 text-[15px] font-medium text-warn">
          {t('group.closedBanner')}
        </p>
      )}

      <section aria-label={t('group.total')} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        <Tile label={t('group.total')} value={money(group.stats.totalSpent)} className="order-2 md:order-1" />
        <Tile label={t('group.share')} value={money(group.stats.myShare)} className="hidden md:order-2 md:flex" />
        <Tile label={t('group.paid')} value={money(group.stats.iPaid)} className="hidden md:order-3 md:flex" />
        <Tile
          label={net > 0 ? t('group.owed') : net < 0 ? t('group.owe') : t('group.square')}
          value={money(Math.abs(net))}
          tone={net > 0 ? 'pos' : net < 0 ? 'neg' : undefined}
          className="order-1 md:order-4"
        />
      </section>

      <div className="flex flex-wrap items-start gap-6">
        <section className="flex min-w-0 flex-[999_1_560px] flex-col rounded-card md:border md:border-line md:bg-surface md:px-5 md:pt-2 md:pb-5">
          <div
            role="tablist"
            aria-label={t('group.tabs')}
            className="flex gap-1 rounded-control border border-line bg-surface2 p-1 md:gap-6 md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0 md:px-1"
          >
            {(['expenses', 'balances'] as const).map((key) => (
              <button
                key={key}
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  'min-h-11 flex-1 cursor-pointer rounded-[10px] px-3.5 text-[15px] font-medium md:min-h-12 md:flex-none md:rounded-none md:border-b-2 md:px-1',
                  tab === key
                    ? 'bg-surface font-semibold text-ink shadow-sm md:border-ink md:bg-transparent md:shadow-none'
                    : 'text-muted hover:text-ink md:border-transparent',
                )}
              >
                {key === 'expenses' ? t('group.tabExpenses') : t('group.tabBalances')}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-2 pb-24 md:pb-0">
            {tab === 'expenses' ? (
              <ExpensesTab group={group} />
            ) : (
              <BalancesTab group={group} balances={balances} />
            )}
          </div>
        </section>

        <aside className="hidden min-w-0 flex-[1_1_340px] flex-col gap-4 md:flex">
          <TransfersCard group={group} balances={balances} />
          <InviteCard group={group} onOpen={() => setInviteOpen(true)} />
          <MembersPanel group={group} card />
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t border-line bg-bg px-5 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden">
        <Link
          to={`/groups/${group.id}/settle`}
          className="flex min-h-13.5 flex-1 items-center justify-center gap-2 rounded-[14px] border border-line bg-surface font-semibold"
        >
          <ArrowLeftRight size={18} aria-hidden="true" />
          {t('group.settle')}
        </Link>
        {!closed && (
          <Link
            to={`/groups/${group.id}/expenses/new`}
            className="flex min-h-13.5 flex-[1.3] items-center justify-center gap-2 rounded-[14px] bg-accent font-semibold text-accent-ink"
          >
            <Plus size={18} strokeWidth={2.4} aria-hidden="true" />
            {t('group.add')}
          </Link>
        )}
      </div>

      <InviteDialog group={group} open={inviteOpen} onOpenChange={setInviteOpen} />
      <Sheet open={membersOpen} onOpenChange={setMembersOpen} title={t('group.members.title')}>
        <MembersPanel group={group} />
      </Sheet>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  className,
}: {
  label: string;
  value: string;
  tone?: 'pos' | 'neg';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-0.5 rounded-2xl border px-3.5 py-3 md:gap-1.5 md:rounded-card md:px-5 md:py-4.5',
        tone === 'pos' ? 'border-transparent bg-pos-bg' : tone === 'neg' ? 'border-transparent bg-neg-bg' : 'border-line bg-surface',
        className,
      )}
    >
      <span className={cn('text-xs md:text-sm', tone === 'pos' ? 'font-medium text-pos' : tone === 'neg' ? 'font-medium text-neg' : 'text-muted')}>
        {label}
      </span>
      <span className={cn('text-[22px] font-bold md:text-[26px]', tone === 'pos' && 'text-pos', tone === 'neg' && 'text-neg')}>{value}</span>
    </div>
  );
}
