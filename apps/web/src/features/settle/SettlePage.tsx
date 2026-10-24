import { ChevronLeft, ReceiptText } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useGroup, type GroupDetail } from '@/api/groupDetail';
import { useSettle, type SettleTransfer, type SettleView } from '@/api/settle';
import { Button, buttonClass } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Dialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { Stamp } from '@/components/ui/Stamp';
import { EmptyState, ErrorState } from '@/components/ui/States';
import { errorCode } from '@/lib/errors';
import { formatMoney, type Lang } from '@/lib/format';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { memberMap } from '../groups/members';
import { PayDialog, RecordDialog, RemindAllDialog } from './Dialogs';
import { PaymentDetailsCard } from './PaymentDetailsCard';
import { RemindPanel } from './RemindPanel';
import { SettledRow, TransferRow } from './TransferRow';
import { roleOf, sortTransfers, summarize } from './settle';

export function Component() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const group = useGroup(id);
  const settle = useSettle(id);

  if (group.isPending || settle.isPending) return <SettleSkeleton />;
  const failed = group.isError ? group : settle.isError ? settle : null;
  if (failed) {
    const missing = failed.isError && ['NOT_FOUND', 'NOT_A_MEMBER'].includes(errorCode(failed.error));
    return (
      <div className="mx-auto max-w-7xl px-5 pt-8 md:px-8 md:pt-10">
        <ErrorState
          error={failed.error}
          title={missing ? t('group.notFoundTitle') : undefined}
          retrying={failed.isFetching}
          onRetry={missing ? undefined : () => void failed.refetch()}
          action={
            <Link to={missing ? '/' : `/groups/${id}`} className={buttonClass('ghost')}>
              {t('group.back')}
            </Link>
          }
        />
      </div>
    );
  }
  return <SettleView group={group.data!} view={settle.data!} />;
}

type Dlg =
  | { kind: 'record'; x: SettleTransfer; mode: 'received' | 'paid' }
  | { kind: 'pay'; x: SettleTransfer }
  | { kind: 'all' }
  | null;

function SettleView({ group, view }: { group: GroupDetail; view: SettleView }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const desktop = useMediaQuery('(min-width: 768px)');
  const meId = group.members.find((m) => m.isMe)?.id;
  const money = (n: number) => formatMoney(n, group.currency, lang);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);

  const s = summarize(view, meId);
  const sorted = sortTransfers(view.outstanding, meId);
  const closed = !!group.closedAt;
  const remindable = closed ? [] : sorted.filter((x) => roleOf(x, meId) === 'creditor' && !x.pendingClaim);
  const selected = remindable.find((x) => x.fromMemberId === picked) ?? remindable[0];
  const name = memberMap(group).get(selected?.fromMemberId ?? '')?.displayName ?? '';

  const [label, amount] =
    s.owedToMe > 0
      ? [t('settle.owedToYou'), s.owedToMe]
      : s.iOwe > 0
        ? [t('settle.youStillOwe'), s.iOwe]
        : [t('settle.stillOpen'), s.others];

  const actions = {
    onRemind: (x: SettleTransfer) => {
      setPicked(x.fromMemberId);
      if (!desktop) setSheet(true);
    },
    onRecord: (x: SettleTransfer, mode: 'received' | 'paid') => setDlg({ kind: 'record', x, mode }),
    onPay: (x: SettleTransfer) => setDlg({ kind: 'pay', x }),
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pt-3 pb-10 md:gap-6 md:px-8 md:pt-6 md:pb-14">
      <div className="flex flex-col gap-1 md:gap-2.5">
        <Link
          to={`/groups/${group.id}`}
          className="inline-flex min-h-11 items-center gap-1.5 self-start rounded-control font-medium text-muted hover:text-ink"
        >
          <ChevronLeft size={20} className="rtl:-scale-x-100" aria-hidden="true" />
          {group.name}
        </Link>
        <h1 className="text-[28px] font-bold tracking-tight md:text-4xl">{t('settle.title')}</h1>
        {view.outstanding.length > 0 && (
          <p className="text-sm text-muted md:text-base">
            {t('group.simplified', { count: view.outstanding.length, expenses: group.expenseCount })}
          </p>
        )}
      </div>

      {closed && (
        <p role="status" className="rounded-control bg-warn-bg px-4 py-3 text-[15px] font-medium text-warn">
          {t('group.closedBanner')}
        </p>
      )}

      <div className="flex flex-wrap items-start gap-6">
        <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
          {s.empty ? (
            <EmptyState
              icon={ReceiptText}
              title={t('settle.emptyTitle')}
              body={t('settle.emptyBody')}
              action={
                !closed && (
                  <Link to={`/groups/${group.id}/expenses/new`} className={buttonClass('primary')}>
                    {t('settle.addExpense')}
                  </Link>
                )
              }
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-4 rounded-card border border-hero-line bg-hero px-5.5 py-5 text-[#f2f3f5]">
                <div className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-sm text-hero-muted">{label}</span>
                  <span className="text-[34px] font-bold text-accent">{money(amount)}</span>
                </div>
                <div className="flex min-w-48 flex-1 flex-col gap-2">
                  <span className="text-[13px] text-hero-muted">
                    {t('settle.progress', { done: money(view.progress.settled), total: money(view.progress.total) })}
                  </span>
                  <div
                    role="progressbar"
                    aria-label={t('settle.progressAria')}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={s.percent}
                    className="flex h-2.5 overflow-hidden rounded-full bg-hero-line"
                  >
                    <span style={{ width: `${s.percent}%` }} className="rounded-full bg-accent transition-[width]" />
                  </div>
                </div>
                {!closed && remindable.length > 1 && (
                  <Button className="max-md:w-full" onClick={() => setDlg({ kind: 'all' })}>
                    {t('settle.remindAll')}
                  </Button>
                )}
              </div>

              {s.allSettled && (
                <div className="flex flex-col items-center gap-3 rounded-card bg-pos-bg px-6 py-10 text-center text-pos">
                  <Stamp iconSize={30} className="border-pos px-5 py-2 text-3xl animate-stamp-in">
                    {t('settle.stamp')}
                  </Stamp>
                  <h2 className="mt-2 text-xl font-semibold">{t('settle.allDoneTitle')}</h2>
                  <p>{t('settle.allDoneBody')}</p>
                </div>
              )}

              {sorted.length > 0 && (
                <ul aria-label={t('settle.sectionOpen')} className="flex flex-col gap-3.5">
                  {sorted.map((x) => (
                    <TransferRow
                      key={`${x.fromMemberId}:${x.toMemberId}`}
                      group={group}
                      x={x}
                      selected={desktop && selected?.fromMemberId === x.fromMemberId && roleOf(x, meId) === 'creditor'}
                      actions={actions}
                    />
                  ))}
                </ul>
              )}

              {view.settled.length > 0 && (
                <>
                  <h2 className="mt-2 text-lg font-semibold">{t('settle.sectionDone')}</h2>
                  <ul className="flex flex-col gap-3">
                    {view.settled.map((p) => (
                      <SettledRow key={p.settlementId} group={group} p={p} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          <PaymentDetailsCard />
        </section>

        {desktop && selected && (
          <aside className="flex min-w-0 flex-[1_1_380px] flex-col rounded-card border border-line bg-surface p-6.5">
            <RemindPanel key={selected.fromMemberId} group={group} view={view} transfer={selected} />
          </aside>
        )}
      </div>

      {!desktop && selected && (
        <Sheet open={sheet} onOpenChange={setSheet} title={t('settle.panel.title', { name })}>
          <RemindPanel key={selected.fromMemberId} group={group} view={view} transfer={selected} bare />
        </Sheet>
      )}

      {dlg?.kind === 'record' && <RecordDialog group={group} transfer={dlg.x} mode={dlg.mode} onClose={() => setDlg(null)} />}
      {dlg?.kind === 'pay' && (
        <PayDialog
          group={group}
          view={view}
          transfer={dlg.x}
          onClose={() => setDlg(null)}
          onPaid={() => setDlg({ kind: 'record', x: dlg.x, mode: 'paid' })}
        />
      )}
      {dlg?.kind === 'all' && <RemindAllDialog group={group} owedToMe={remindable} onClose={() => setDlg(null)} />}
    </div>
  );
}

function SettleSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pt-3 pb-10 md:gap-6 md:px-8 md:pt-6">
      <span role="status" className="sr-only">
        {t('common.loading')}
      </span>
      <Skeleton className="h-11 w-32 rounded-control" />
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-28 rounded-card" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-24 rounded-[18px]" />
      ))}
    </div>
  );
}
