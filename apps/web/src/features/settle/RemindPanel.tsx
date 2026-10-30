import { idempotencyKey } from '@settled/api-client';
import type { ReminderTone } from '@settled/core';
import { Check, Send } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@/api/config';
import type { GroupDetail } from '@/api/groupDetail';
import {
  useReminderHistory,
  useSendReminderMutation,
  useStopReminderMutation,
  type Reminder,
  type ReminderChannel,
  type SettleTransfer,
  type SettleView,
} from '@/api/settle';
import { Button } from '@/components/ui/Button';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { reportError } from '@/lib/errorDialog';
import { errorCode } from '@/lib/errors';
import { formatDate, type Lang } from '@/lib/format';
import { toast } from '@/lib/toast';
import { memberMap } from '../groups/members';
import { AutoSwitch, ChannelChips, ToneChips } from './controls';
import {
  activeAutoRepeat,
  buildReminderMessage,
  channelAvailability,
  cooldownLeftMs,
  firstAvailable,
  formatAgo,
  handoffUrl,
  isHandoff,
  isSafeHandoff,
} from './settle';

/** Compose + send for one transfer owed to me. Mount with `key` = the debtor so state resets per person. */
export function RemindPanel({
  group,
  view,
  transfer,
  bare,
}: {
  group: GroupDetail;
  view: SettleView;
  transfer: SettleTransfer;
  /** The sheet already shows who it is for. */
  bare?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const members = memberMap(group);
  const me = members.get(transfer.toMemberId);
  const debtor = members.get(transfer.fromMemberId);
  const { data: config } = useConfig();
  const available = channelAvailability(debtor, config?.reminderChannels);

  const [tone, setTone] = useState<ReminderTone>('friendly');
  const [channel, setChannel] = useState<ReminderChannel>(() => firstAvailable(available) ?? 'email');
  const [edited, setEdited] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [sent, setSent] = useState<Reminder | null>(null);
  const key = useRef(idempotencyKey());
  const send = useSendReminderMutation(group.id);
  const stop = useStopReminderMutation(group.id);
  const history = useReminderHistory(group.id, transfer.fromMemberId);

  const built = useMemo(
    () =>
      buildReminderMessage({
        tone,
        lang,
        debtor: { displayName: debtor?.displayName ?? '', gender: debtor?.gender ?? null },
        creditorName: me?.displayName ?? '',
        amount: transfer.amount,
        currency: group.currency,
        groupName: group.name,
        details: view.myPaymentDetails,
      }),
    [tone, lang, debtor, me, transfer.amount, group.currency, group.name, view.myPaymentDetails],
  );
  const message = edited ?? built;
  const name = debtor?.displayName ?? '';
  const cooldown = cooldownLeftMs(transfer.lastReminder?.sentAt);
  const running = activeAutoRepeat(history.data?.items ?? [], me?.id);

  const onSend = () =>
    send.mutate(
      { body: { toMemberId: transfer.fromMemberId, tone, channel, message: message.trim(), autoRepeat: auto }, key: key.current },
      {
        onSuccess: (r) => {
          key.current = idempotencyKey();
          setSent(r);
          // Usually blocked after an async hop; the button below is the reliable path
          const url = handoffUrl(r);
          if (url && isSafeHandoff(url)) window.open(url, '_blank', 'noopener');
        },
        onError: (e) => (errorCode(e) === 'RATE_LIMITED' ? toast.warn(t('settle.panel.cooldownToast')) : reportError(e)),
      },
    );

  const handoff = sent ? handoffUrl(sent) : null;
  const sendLabel = channel === 'whatsapp' ? t('settle.panel.sendWhatsapp') : channel === 'sms' ? t('settle.panel.sendSms') : t('settle.panel.send');

  return (
    <div className="flex flex-col gap-5">
      {!bare && (
        <div className="flex items-center gap-3">
          <MemberAvatar name={debtor?.displayName} color={debtor?.color} size={44} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-xl font-semibold">{t('settle.panel.title', { name })}</h2>
            <span className="text-sm text-muted">
              {transfer.lastReminder
                ? t('settle.statusReminded', { when: formatAgo(transfer.lastReminder.sentAt, lang, new Date(), t('settle.justNow')) })
                : t('settle.statusOpenCreditor')}
            </span>
          </div>
        </div>
      )}

      <ToneChips
        value={tone}
        onChange={(v) => {
          setTone(v);
          setEdited(null);
          setSent(null);
        }}
      />

      <div className="flex flex-col gap-2.5">
        <label htmlFor="reminder-msg" className="text-sm font-medium text-muted">
          {t('settle.panel.message')}
        </label>
        <textarea
          id="reminder-msg"
          value={message}
          maxLength={1000}
          onChange={(e) => {
            setEdited(e.target.value);
            setSent(null);
          }}
          className="min-h-33 w-full resize-y rounded-[14px] border border-line bg-surface2 p-3.5 text-[15px] leading-relaxed text-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent"
        />
      </div>

      <ChannelChips
        value={channel}
        available={available}
        onChange={(c) => {
          setChannel(c);
          setSent(null);
        }}
      />
      <AutoSwitch checked={auto} onChange={setAuto} />

      {cooldown > 0 && !sent && (
        <p className="text-sm text-muted">{t('settle.panel.cooldown', { name, hours: Math.ceil(cooldown / 3_600_000) })}</p>
      )}

      {sent ? (
        <div className="flex flex-col gap-2.5">
          <div role="status" className="flex min-h-13.5 items-center justify-center gap-2 rounded-control bg-pos-bg px-4 text-center font-semibold text-pos">
            <Check size={18} strokeWidth={2.6} aria-hidden="true" />
            {isHandoff(sent.channel) ? t('settle.panel.sentHandoff') : t('settle.panel.sent', { name })}
          </div>
          {handoff && isSafeHandoff(handoff) && (
            <a
              href={handoff}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-13.5 items-center justify-center gap-2 rounded-control bg-accent font-semibold text-accent-ink hover:brightness-95"
            >
              {sent.channel === 'whatsapp' ? t('settle.panel.openWhatsapp') : t('settle.panel.openSms')}
            </a>
          )}
          <Button variant="text" onClick={() => setSent(null)}>
            {t('settle.panel.again')}
          </Button>
        </div>
      ) : (
        <Button size="lg" loading={send.isPending} disabled={!message.trim() || !available[channel]} onClick={onSend}>
          <Send size={18} className="rtl:-scale-x-100" aria-hidden="true" />
          {sendLabel}
        </Button>
      )}

      <section aria-label={t('settle.panel.history')} className="flex flex-col gap-2.5 border-t border-line pt-4">
        <h3 className="text-sm font-semibold">{t('settle.panel.history')}</h3>
        {running && (
          <div className="flex items-center gap-3 rounded-control bg-surface2 p-3 text-sm">
            <span className="flex-1">{t('settle.panel.autoActive')}</span>
            <Button
              variant="ghost"
              loading={stop.isPending}
              onClick={() => stop.mutate(running.id, { onSuccess: () => toast.success(t('settle.panel.stopped')) })}
            >
              {t('settle.panel.stop')}
            </Button>
          </div>
        )}
        {history.data && history.data.items.length === 0 && <p className="text-sm text-muted">{t('settle.panel.historyEmpty')}</p>}
        <ul className="flex flex-col gap-1.5">
          {history.data?.items.slice(0, 3).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 text-sm text-muted">
              <span>
                {t('settle.panel.historyItem', { channel: t(`settle.channels.${r.channel}`), tone: t(`settle.tones.${r.tone}`) })}
                {r.status === 'failed' && ` · ${t('settle.panel.failed')}`}
              </span>
              <span>{formatDate(r.sentAt ?? r.createdAt, lang, { day: 'numeric', month: 'short' })}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
