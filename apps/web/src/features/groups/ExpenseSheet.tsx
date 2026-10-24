import { Paperclip, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useDeleteExpenseMutation, type Expense } from '@/api/expenses';
import type { GroupDetail } from '@/api/groupDetail';
import { Button } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { ConfirmDialog, Sheet } from '@/components/ui/Dialog';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { cn } from '@/lib/cn';
import { effectFor } from '@/lib/expenses';
import { formatDate, formatMoney, type Lang } from '@/lib/format';
import { toast } from '@/lib/toast';
import { useSplitLabel } from './expenseLabels';
import { memberMap } from './members';

/** Read-only expense detail with edit / delete. Keeps the last expense mounted so the close animation has content. */
export function ExpenseSheet({
  group,
  expense,
  open,
  onClose,
}: {
  group: GroupDetail;
  expense: Expense | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const navigate = useNavigate();
  const del = useDeleteExpenseMutation(group.id);
  const [confirm, setConfirm] = useState(false);
  const [last, setLast] = useState(expense);
  if (expense && expense !== last) setLast(expense);
  const e = expense ?? last;
  const split = useSplitLabel();
  if (!e) return null;

  const members = memberMap(group);
  const payer = members.get(e.paidByMemberId);
  const me = group.members.find((m) => m.isMe)?.id;
  const eff = effectFor(e, me);
  const fx = e.currency !== group.currency;
  const money = (n: number, cur = group.currency) => formatMoney(n, cur, lang);

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={e.description}
        description={`${t(`group.categories.${e.category}`)} · ${formatDate(e.date, lang, { dateStyle: 'medium' })}`}
        footer={
          group.closedAt ? undefined : (
            <>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                <Trash2 size={18} aria-hidden="true" />
                {t('group.detail.delete')}
              </Button>
              <Button onClick={() => navigate(`/groups/${group.id}/expenses/${e.id}/edit`)}>
                <Pencil size={18} aria-hidden="true" />
                {t('group.detail.edit')}
              </Button>
            </>
          )
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3.5 rounded-2xl bg-surface2 p-4">
            <CategoryIcon category={e.category} size={48} />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-2xl font-bold">{money(e.amount, e.currency)}</span>
              {fx && (
                <span className="text-sm text-muted">
                  {t('group.detail.inGroup', { amount: money(e.baseAmount) })} ·{' '}
                  <span dir="ltr">{t('group.detail.rate', { rate: e.fxRate })}</span>
                </span>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[15px]">
            <dt className="text-muted">{t('group.detail.paidBy')}</dt>
            <dd className="flex items-center gap-2 font-medium">
              {payer && <MemberAvatar name={payer.displayName} color={payer.color} size={24} />}
              {payer?.isMe ? t('group.youPaid') : payer?.displayName}
            </dd>
            <dt className="text-muted">{t('group.detail.split')}</dt>
            <dd className="font-medium">{split(e)}</dd>
            <dt className="text-muted">{t('group.detail.yourPart')}</dt>
            <dd
              className={cn(
                'font-medium',
                eff.kind === 'lent' ? 'text-pos' : eff.kind === 'borrowed' ? 'text-neg' : 'text-muted',
              )}
            >
              {eff.kind === 'lent'
                ? t('group.lent', { amount: money(eff.amount) })
                : eff.kind === 'borrowed'
                  ? t('group.borrowed', { amount: money(eff.amount) })
                  : t('group.notInvolved')}
            </dd>
          </dl>

          <section aria-labelledby="exp-who" className="flex flex-col gap-2">
            <h3 id="exp-who" className="text-sm font-semibold text-muted">
              {t('group.detail.who')}
            </h3>
            <ul className="flex flex-col gap-1.5">
              {e.shares.map((s) => {
                const m = members.get(s.memberId);
                return (
                  <li key={s.memberId} className="flex min-h-11 items-center gap-2.5 rounded-control bg-surface2 px-3">
                    <MemberAvatar name={m?.displayName} color={m?.color} size={28} />
                    <span className="flex-1 truncate">
                      {m?.displayName}
                      {m?.isMe && <span className="ms-1 text-muted">{t('group.you')}</span>}
                    </span>
                    <span className="font-semibold">{money(s.amount)}</span>
                  </li>
                );
              })}
            </ul>
          </section>

          {e.hasReceipt && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Paperclip size={16} aria-hidden="true" />
              {t('group.detail.receipt')}
            </p>
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        danger
        title={t('group.detail.deleteTitle')}
        description={t('group.detail.deleteBody', { name: e.description })}
        confirmLabel={t('group.detail.delete')}
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(e.id, {
            onSuccess: () => {
              setConfirm(false);
              onClose();
              toast.success(t('group.detail.deleted'));
            },
          })
        }
      />
    </>
  );
}
