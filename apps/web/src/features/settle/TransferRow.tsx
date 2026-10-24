import { ArrowLeftRight, Bell, Check, ChevronRight, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupDetail } from '@/api/groupDetail';
import { useSettlementActionMutation, useUndoSettlementMutation, type SettledPayment, type SettleTransfer } from '@/api/settle';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { Stamp } from '@/components/ui/Stamp';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney, type Lang } from '@/lib/format';
import { toast } from '@/lib/toast';
import { memberMap } from '../groups/members';
import { canUndo, formatAgo, roleOf, transferStatus } from './settle';

function Flow({ group, fromId, toId, amount }: { group: GroupDetail; fromId: string; toId: string; amount: number }) {
  const { i18n } = useTranslation();
  const members = memberMap(group);
  const from = members.get(fromId);
  const to = members.get(toId);
  return (
    <div className="flex items-center gap-2.5">
      <MemberAvatar name={from?.displayName} color={from?.color} size={44} />
      <span className="flex min-w-20 flex-col items-center gap-0.5">
        <span className="text-lg font-bold">{formatMoney(amount, group.currency, i18n.language as Lang)}</span>
        <span className="flex w-full items-center text-muted" aria-hidden="true">
          <span className="h-0.5 flex-1 bg-current opacity-40" />
          <ChevronRight size={14} strokeWidth={2.4} className="rtl:-scale-x-100" />
        </span>
      </span>
      <MemberAvatar name={to?.displayName} color={to?.color} size={44} />
    </div>
  );
}

export interface RowActions {
  onRemind: (x: SettleTransfer) => void;
  onRecord: (x: SettleTransfer, mode: 'received' | 'paid') => void;
  onPay: (x: SettleTransfer) => void;
}

/** One outstanding transfer, with the actions that fit my side of it. */
export function TransferRow({
  group,
  x,
  selected,
  actions,
}: {
  group: GroupDetail;
  x: SettleTransfer;
  selected: boolean;
  actions: RowActions;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const members = memberMap(group);
  const meId = group.members.find((m) => m.isMe)?.id;
  const role = roleOf(x, meId);
  const from = members.get(x.fromMemberId)?.displayName ?? '';
  const to = members.get(x.toMemberId)?.displayName ?? '';
  const status = transferStatus(x);
  const closed = !!group.closedAt;
  const money = formatMoney(x.amount, group.currency, lang);

  const confirm = useSettlementActionMutation(group.id, 'confirm');
  const reject = useSettlementActionMutation(group.id, 'reject');
  const undo = useUndoSettlementMutation(group.id);
  const [undoOpen, setUndoOpen] = useState(false);

  const text =
    role === 'creditor' ? t('settle.owesYou', { name: from }) : role === 'debtor' ? t('settle.youOwe', { name: to }) : t('settle.owes', { from, to });
  const statusText =
    status === 'claimPending'
      ? role === 'creditor'
        ? t('settle.claimCreditor', { name: from })
        : role === 'debtor'
          ? t('settle.claimDebtor', { name: to })
          : t('settle.claimOther')
      : status === 'reminded'
        ? t(x.lastReminder?.autoRepeat ? 'settle.statusRemindedAuto' : 'settle.statusReminded', {
            when: formatAgo(x.lastReminder!.sentAt, lang, new Date(), t('settle.justNow')),
          })
        : role === 'creditor'
          ? t('settle.statusOpenCreditor')
          : role === 'debtor'
            ? t('settle.statusOpenDebtor')
            : t('settle.statusOpenOther');

  const claim = x.pendingClaim;
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-4 rounded-[18px] border-[1.5px] bg-surface p-4.5',
        selected ? 'border-ink shadow-[0_0_0_1px_var(--ink)]' : 'border-line',
      )}
    >
      <div className="flex min-w-64 flex-1 flex-wrap items-center gap-x-4 gap-y-2.5">
        <Flow group={group} fromId={x.fromMemberId} toId={x.toMemberId} amount={x.amount} />
        <span className="flex min-w-40 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{text}</span>
          <span className="text-[13px] text-muted">{statusText}</span>
        </span>
      </div>

      {!closed && (
        <div className="flex flex-wrap gap-2">
          {role === 'creditor' && claim && (
            <>
              <Button
                loading={confirm.isPending}
                onClick={() => confirm.mutate(claim.settlementId, { onSuccess: () => toast.success(t('settle.confirmed')) })}
              >
                <Check size={17} aria-hidden="true" />
                {t('settle.confirm')}
              </Button>
              <Button
                variant="ghost"
                loading={reject.isPending}
                onClick={() => reject.mutate(claim.settlementId, { onSuccess: () => toast.success(t('settle.rejected')) })}
              >
                {t('settle.reject')}
              </Button>
            </>
          )}
          {role === 'creditor' && !claim && (
            <>
              <Button variant="ghost" onClick={() => actions.onRecord(x, 'received')}>
                <Check size={17} aria-hidden="true" />
                {t('settle.markReceived')}
              </Button>
              <Button variant="ink" aria-pressed={selected} onClick={() => actions.onRemind(x)}>
                <Bell size={17} aria-hidden="true" />
                {t('settle.remind')}
              </Button>
            </>
          )}
          {role === 'debtor' && !claim && (
            <>
              <Button onClick={() => actions.onPay(x)}>
                <ArrowLeftRight size={17} aria-hidden="true" />
                {t('settle.pay', { amount: money })}
              </Button>
              <Button variant="ghost" onClick={() => actions.onRecord(x, 'paid')}>
                {t('settle.markPaid')}
              </Button>
            </>
          )}
          {role === 'debtor' && claim && (
            <Button variant="ghost" onClick={() => setUndoOpen(true)}>
              <Undo2 size={17} aria-hidden="true" />
              {t('settle.undo')}
            </Button>
          )}
        </div>
      )}

      {claim && (
        <ConfirmDialog
          open={undoOpen}
          onOpenChange={setUndoOpen}
          title={t('settle.undoTitle')}
          description={t('settle.undoBody')}
          confirmLabel={t('settle.undo')}
          loading={undo.isPending}
          onConfirm={() =>
            undo.mutate(claim.settlementId, {
              onSuccess: () => {
                setUndoOpen(false);
                toast.success(t('settle.undone'));
              },
            })
          }
        />
      )}
    </li>
  );
}

export function SettledRow({ group, p }: { group: GroupDetail; p: SettledPayment }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const members = memberMap(group);
  const meId = group.members.find((m) => m.isMe)?.id;
  const from = members.get(p.fromMemberId)?.displayName ?? '';
  const to = members.get(p.toMemberId)?.displayName ?? '';
  const role = roleOf(p, meId);
  const undo = useUndoSettlementMutation(group.id);
  const [open, setOpen] = useState(false);

  const text =
    role === 'creditor' ? t('settle.paidYou', { name: from }) : role === 'debtor' ? t('settle.youPaid', { name: to }) : t('settle.paid', { from, to });
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-[18px] border border-line bg-surface p-4">
      <div className="flex min-w-64 flex-1 flex-wrap items-center gap-x-4 gap-y-2.5">
        <Flow group={group} fromId={p.fromMemberId} toId={p.toMemberId} amount={p.baseAmount} />
        <span className="flex min-w-40 flex-1 flex-col gap-0.5">
          <span className="text-base font-semibold">{text}</span>
          {p.confirmedAt && <span className="text-[13px] text-muted">{t('settle.received', { date: formatDate(p.confirmedAt, lang, { day: 'numeric', month: 'short' }) })}</span>}
        </span>
      </div>
      {role !== 'other' && !group.closedAt && canUndo(p.confirmedAt) && (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          <Undo2 size={17} aria-hidden="true" />
          {t('settle.undo')}
        </Button>
      )}
      <Stamp iconSize={16} className="rotate-[-7deg] gap-1.5 rounded-xl border-[2.5px] border-pos px-3.5 py-1 text-xl text-pos">
        {t('settle.stamp')}
      </Stamp>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('settle.undoTitle')}
        description={t('settle.undoBody')}
        confirmLabel={t('settle.undo')}
        loading={undo.isPending}
        onConfirm={() =>
          undo.mutate(p.settlementId, {
            onSuccess: () => {
              setOpen(false);
              toast.success(t('settle.undone'));
            },
          })
        }
      />
    </li>
  );
}
