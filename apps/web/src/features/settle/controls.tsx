import { Bell, Mail, MessageCircle, MessageSquare } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReminderTone } from '@settled/core';
import type { ReminderChannel } from '@/api/settle';
import { cn } from '@/lib/cn';
import { Switch } from '../settings/controls';
import { CHANNELS, TONES } from './settle';

export const chipClass = (on: boolean) =>
  cn(
    'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[1.5px] px-3.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
    on ? 'border-ink bg-ink text-bg' : 'border-line bg-surface2 text-ink hover:border-muted',
  );

const channelIcon = { whatsapp: MessageCircle, sms: MessageSquare, email: Mail, push: Bell } as const;

export function ToneChips({ value, onChange }: { value: ReminderTone; onChange: (t: ReminderTone) => void }) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <span id={id} className="text-sm font-medium text-muted">
        {t('settle.panel.tone')}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {TONES.map((tone) => (
          <button key={tone} type="button" aria-pressed={value === tone} className={chipClass(value === tone)} onClick={() => onChange(tone)}>
            {t(`settle.tones.${tone}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChannelChips({
  value,
  onChange,
  available,
}: {
  value: ReminderChannel;
  onChange: (c: ReminderChannel) => void;
  available: Record<ReminderChannel, boolean>;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <span id={id} className="text-sm font-medium text-muted">
        {t('settle.panel.via')}
      </span>
      <div role="group" aria-labelledby={id} className="flex flex-wrap gap-2">
        {CHANNELS.map((c) => {
          const Icon = channelIcon[c];
          const off = !available[c];
          return (
            <button
              key={c}
              type="button"
              aria-pressed={value === c}
              disabled={off}
              title={off ? t('settle.panel.channelOff') : undefined}
              className={chipClass(value === c)}
              onClick={() => onChange(c)}
            >
              <Icon size={16} aria-hidden="true" />
              {t(`settle.channels.${c}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function AutoSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3.5 rounded-[14px] border border-line bg-surface2 p-4">
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">
          {t('settle.panel.auto')}
        </span>
        <span className="text-[13px] text-muted">{t('settle.panel.autoSub')}</span>
      </div>
      <Switch checked={checked} onChange={onChange} label={t('settle.panel.auto')} />
    </div>
  );
}
