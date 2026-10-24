import { idempotencyKey } from '@settled/api-client';
import type { PayOption, ReminderTone } from '@settled/core';
import { Copy, ExternalLink } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupDetail } from '@/api/groupDetail';
import { usePutPaymentDetailsMutation, type MyPaymentDetails } from '@/api/me';
import {
  useRecordSettlementMutation,
  useRemindAllMutation,
  type PayMethod,
  type ReminderChannel,
  type SettleTransfer,
  type SettleView,
} from '@/api/settle';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { inputClass } from '@/components/ui/Input';
import { parseAmount, sanitizeAmount } from '@/lib/expenseForm';
import { formatMoney, type Lang } from '@/lib/format';
import { toast } from '@/lib/toast';
import { toMajorString } from '@settled/core';
import { memberMap } from '../groups/members';
import { AutoSwitch, ChannelChips, chipClass, ToneChips } from './controls';
import { channelAvailability } from './settle';

const METHODS: PayMethod[] = ['bit', 'paybox', 'paypal', 'revolut', 'bank', 'cash', 'other'];

/** "Mark received" (I'm the receiver: confirmed at once) or "I paid" (I'm the payer: waits for confirmation). */
export function RecordDialog({
  group,
  transfer,
  mode,
  onClose,
}: {
  group: GroupDetail;
  transfer: SettleTransfer;
  mode: 'received' | 'paid';
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const other = memberMap(group).get(mode === 'received' ? transfer.fromMemberId : transfer.toMemberId);
  const [text, setText] = useState(toMajorString(transfer.amount, group.currency));
  const [method, setMethod] = useState<PayMethod | null>(null);
  const [touched, setTouched] = useState(false);
  const key = useRef(idempotencyKey());
  const record = useRecordSettlementMutation(group.id);

  const parsed = parseAmount(text, group.currency);
  const max = Math.floor(transfer.amount * 1.01);
  const error =
    'error' in parsed ? t('settle.record.invalid') : parsed.minor > max ? t('settle.record.tooMuch', { max: formatMoney(transfer.amount, group.currency, lang) }) : null;

  const submit = () => {
    setTouched(true);
    if (error || !('minor' in parsed)) return;
    record.mutate(
      {
        key: key.current,
        body: {
          fromMemberId: transfer.fromMemberId,
          toMemberId: transfer.toMemberId,
          amount: parsed.minor,
          currency: group.currency,
          method,
        },
      },
      {
        onSuccess: () => {
          key.current = idempotencyKey();
          toast.success(mode === 'received' ? t('settle.recorded') : t('settle.claimed'));
          onClose();
        },
      },
    );
  };

  const name = other?.displayName ?? '';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={mode === 'received' ? t('settle.record.receivedTitle', { name }) : t('settle.record.paidTitle', { name })}
      description={mode === 'received' ? t('settle.record.receivedSub') : t('settle.record.paidSub', { name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={record.isPending} onClick={submit}>
            {mode === 'received' ? t('settle.record.submitReceived') : t('settle.record.submitPaid')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="settle-amount" className="text-sm font-medium text-muted">
            {t('settle.record.amount')} ({group.currency})
          </label>
          <input
            id="settle-amount"
            dir="ltr"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            aria-invalid={touched && !!error}
            aria-describedby={touched && error ? 'settle-amount-err' : undefined}
            onChange={(e) => setText(sanitizeAmount(e.target.value))}
            className={`${inputClass} text-start`}
          />
          {touched && error && (
            <p id="settle-amount-err" role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span id="settle-method" className="text-sm font-medium text-muted">
            {t('settle.record.method')}
          </span>
          <div role="group" aria-labelledby="settle-method" className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={method === null} className={chipClass(method === null)} onClick={() => setMethod(null)}>
              {t('settle.record.noMethod')}
            </button>
            {METHODS.map((m) => (
              <button key={m} type="button" aria-pressed={method === m} className={chipClass(method === m)} onClick={() => setMethod(m)}>
                {t(`settle.methods.${m}`)}
              </button>
            ))}
          </div>
        </div>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Payer side: the creditor's pay options (deep link where one exists, otherwise copyable details). */
export function PayDialog({
  group,
  view,
  transfer,
  onClose,
  onPaid,
}: {
  group: GroupDetail;
  view: SettleView;
  transfer: SettleTransfer;
  onClose: () => void;
  onPaid: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const to = memberMap(group).get(transfer.toMemberId);
  const options: PayOption[] = view.myPayOptions.find((o) => o.toMemberId === transfer.toMemberId)?.options ?? [];
  const name = to?.displayName ?? '';

  const onCopy = async (text: string) => (await copy(text) ? toast.success(t('settle.payDlg.copied')) : toast.warn(t('settle.payDlg.copyFailed')));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('settle.payDlg.title', { name })}
      description={t('settle.payDlg.sub', { amount: formatMoney(transfer.amount, group.currency, lang) })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={onPaid}>{t('settle.payDlg.done')}</Button>
        </>
      }
    >
      {options.length === 0 ? (
        <p className="text-[15px] text-muted">{t('settle.payDlg.none', { name })}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {options.map((o) => (
            <li key={o.method} className="flex flex-col gap-2 rounded-[14px] bg-surface2 p-3.5">
              <span className="text-sm font-semibold">{t(`settle.methods.${o.method}`)}</span>
              {o.copyText && (
                <span dir="ltr" className="text-start text-[15px] break-words whitespace-pre-line">
                  {o.copyText}
                </span>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {o.url && /^https:\/\//.test(o.url) && (
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center gap-2 rounded-control bg-accent px-4 text-[15px] font-semibold text-accent-ink hover:brightness-95"
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    {t('settle.payDlg.open', { label: t(`settle.methods.${o.method}`) })}
                  </a>
                )}
                {o.copyText && (
                  <Button variant="ghost" onClick={() => void onCopy(o.copyText!)}>
                    <Copy size={16} aria-hidden="true" />
                    {t('settle.payDlg.copy')}
                  </Button>
                )}
              </div>
              {o.url && !o.amountPrefilled && <p className="text-[13px] text-muted">{t('settle.payDlg.noAmount')}</p>}
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

export function RemindAllDialog({
  group,
  owedToMe,
  onClose,
}: {
  group: GroupDetail;
  owedToMe: SettleTransfer[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tone, setTone] = useState<ReminderTone>('friendly');
  const [channel, setChannel] = useState<ReminderChannel>('push');
  const [auto, setAuto] = useState(true);
  const key = useRef(idempotencyKey());
  const all = useRemindAllMutation(group.id);

  // A channel is offered if it can reach at least one of the people being reminded
  const available = useMemo(() => {
    const members = memberMap(group);
    const merged = { whatsapp: false, sms: false, email: false, push: false };
    for (const x of owedToMe) {
      const a = channelAvailability(members.get(x.fromMemberId));
      for (const c of Object.keys(merged) as ReminderChannel[]) merged[c] ||= a[c];
    }
    return merged;
  }, [group, owedToMe]);

  const send = () =>
    all.mutate(
      { body: { tone, channel, autoRepeat: auto }, key: key.current },
      {
        onSuccess: (r) => {
          key.current = idempotencyKey();
          const sent = r.created.length;
          const skipped = r.skipped.length;
          toast.success(skipped ? t('settle.all.resultSkipped', { sent, skipped }) : t('settle.all.result', { sent }));
          onClose();
        },
      },
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('settle.all.title')}
      description={t('settle.all.body')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={all.isPending} disabled={!available[channel]} onClick={send}>
            {t('settle.all.send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <ToneChips value={tone} onChange={setTone} />
        <ChannelChips value={channel} onChange={setChannel} available={available} />
        <AutoSwitch checked={auto} onChange={setAuto} />
      </div>
    </Dialog>
  );
}

const FIELDS = ['bitPhone', 'payboxPhone', 'paypalMe', 'revolutTag', 'bankDetails'] as const;

export function PaymentDetailsDialog({ initial, onClose }: { initial: MyPaymentDetails | undefined; onClose: () => void }) {
  const { t } = useTranslation();
  const [values, setValues] = useState<Record<(typeof FIELDS)[number], string>>(() => ({
    bitPhone: initial?.bitPhone ?? '',
    payboxPhone: initial?.payboxPhone ?? '',
    paypalMe: initial?.paypalMe ?? '',
    revolutTag: initial?.revolutTag ?? '',
    bankDetails: initial?.bankDetails ?? '',
  }));
  const put = usePutPaymentDetailsMutation();

  const save = () =>
    put.mutate(values, {
      onSuccess: () => {
        toast.success(t('settle.paySaved'));
        onClose();
      },
    });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('settle.payEditTitle')}
      description={t('settle.payEditSub')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={put.isPending} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {FIELDS.map((f) => (
          <div key={f} className="flex flex-col gap-1.5">
            <label htmlFor={`pd-${f}`} className="text-sm font-medium text-muted">
              {t(`settle.payFields.${f}`)}
            </label>
            {f === 'bankDetails' ? (
              <textarea
                id={`pd-${f}`}
                value={values[f]}
                maxLength={300}
                placeholder={t(`settle.payHints.${f}`)}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                className={`${inputClass} min-h-20 py-2.5`}
              />
            ) : (
              <input
                id={`pd-${f}`}
                dir="ltr"
                value={values[f]}
                maxLength={40}
                inputMode={f.endsWith('Phone') ? 'tel' : 'text'}
                autoComplete="off"
                placeholder={t(`settle.payHints.${f}`)}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                className={`${inputClass} text-start`}
              />
            )}
          </div>
        ))}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
