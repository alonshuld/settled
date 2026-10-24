import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePaymentDetails } from '@/api/me';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { PaymentDetailsDialog } from './Dialogs';

const FIELDS = ['bitPhone', 'payboxPhone', 'paypalMe', 'revolutTag', 'bankDetails'] as const;

/** "How people pay you": what reminders carry, with an inline edit. */
export function PaymentDetailsCard() {
  const { t } = useTranslation();
  const q = usePaymentDetails();
  const [editing, setEditing] = useState(false);
  const filled = q.data ? FIELDS.filter((f) => q.data[f]) : [];

  return (
    <section aria-labelledby="paydetails-h" className="flex flex-col gap-3.5 rounded-card border border-line bg-surface p-5.5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="paydetails-h" className="text-lg font-semibold">
          {t('settle.payTitle')}
        </h2>
        {q.data && (
          <Button variant="text" onClick={() => setEditing(true)}>
            {filled.length ? t('settle.payEdit') : t('settle.payAdd')}
          </Button>
        )}
      </div>
      <p className="-mt-2 text-sm text-muted">{t('settle.paySub')}</p>
      {q.isPending && <Skeleton className="h-16 rounded-[14px]" />}
      {q.isError && <ErrorState bare error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />}
      {q.data &&
        (filled.length === 0 ? (
          <p className="rounded-[14px] bg-surface2 p-3.5 text-[15px] text-muted">{t('settle.payEmpty')}</p>
        ) : (
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2.5">
            {filled.map((f) => (
              <div key={f} className="flex flex-col gap-1 rounded-[14px] bg-surface2 px-4 py-3.5">
                <dt className="text-[13px] text-muted">{t(`settle.payFields.${f}`)}</dt>
                <dd dir={f === 'bankDetails' ? 'auto' : 'ltr'} className="text-start font-semibold break-words whitespace-pre-line">
                  {q.data[f]}
                </dd>
              </div>
            ))}
          </dl>
        ))}
      {editing && <PaymentDetailsDialog initial={q.data} onClose={() => setEditing(false)} />}
    </section>
  );
}
