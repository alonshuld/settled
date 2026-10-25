import { useTranslation } from 'react-i18next';
import { useNotificationPrefs, usePatchPrefsMutation, type NotificationPrefs } from '@/api/me';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { Switch, sectionCard } from './controls';
import { PushRow } from './PushRow';

const KEYS = ['remindersToMe', 'newExpenses', 'paymentsReceived', 'weeklySummary'] as const satisfies readonly (keyof NotificationPrefs)[];

export function NotificationsSection() {
  const { t } = useTranslation();
  const q = useNotificationPrefs();
  const patch = usePatchPrefsMutation();

  return (
    <section id="notifications" aria-labelledby="notif-h" className={`${sectionCard} flex flex-col`}>
      <div className="flex flex-col gap-1 pb-3">
        <h2 id="notif-h" className="text-xl font-semibold">
          {t('settings.sections.notifications')}
        </h2>
        <span className="text-sm text-muted">{t('settings.notifSub')}</span>
      </div>
      {q.isPending && <Skeleton className="h-56 rounded-[14px]" />}
      {q.isError && <ErrorState bare error={q.error} retrying={q.isFetching} onRetry={() => void q.refetch()} />}
      {q.data &&
        KEYS.map((k) => (
          <div key={k} className="flex items-center gap-4 border-t border-line py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-base font-medium">{t(`settings.prefs.${k}.label`)}</span>
              <span className="text-sm text-muted">{t(`settings.prefs.${k}.sub`)}</span>
            </div>
            <Switch label={t(`settings.prefs.${k}.label`)} checked={q.data[k]} onChange={(v) => patch.mutate({ [k]: v })} />
          </div>
        ))}
      <PushRow />
    </section>
  );
}
