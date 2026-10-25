import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@/api/config';
import { useAddPushMutation, useRemovePushMutation } from '@/api/me';
import {
  browserPushEnv,
  currentSubscription,
  pushSupport,
  subscribeToPush,
  toSubscriptionBody,
} from '@/lib/push';
import { toast } from '@/lib/toast';
import { Switch } from './controls';

/** Web Push opt-in. Degrades to an explanation when the browser, the permission or the server key is missing. */
export function PushRow() {
  const { t } = useTranslation();
  const config = useConfig();
  const add = useAddPushMutation();
  const remove = useRemovePushMutation();
  const [env] = useState(browserPushEnv);
  const [subscribed, setSubscribed] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);

  const key = config.data?.push.vapidPublicKey ?? null;
  const support = denied ? 'denied' : pushSupport(key, env);

  useEffect(() => {
    if (!env.hasApis) return;
    let alive = true;
    void currentSubscription()
      .then((s) => alive && setSubscribed(Boolean(s) && Notification.permission === 'granted'))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [env.hasApis]);

  async function enable() {
    if (!key) return;
    setBusy(true);
    try {
      const res = await subscribeToPush(key);
      if (!res.ok) {
        if (res.reason === 'denied') setDenied(true);
        else toast.warn(t('settings.push.failed'));
        return;
      }
      await add.mutateAsync(res.body);
      setSubscribed(true);
      toast.success(t('settings.push.enabled'));
    } catch {
      // the mutation cache already toasted the API error
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      const body = sub ? toSubscriptionBody(sub.toJSON()) : null;
      // Subscribing again is an upsert by endpoint: it hands back the id the DELETE needs
      if (body) await remove.mutateAsync((await add.mutateAsync(body)).id);
      await sub?.unsubscribe();
      setSubscribed(false);
      toast.success(t('settings.push.disabled'));
    } catch {
      // surfaced by the mutation cache
    } finally {
      setBusy(false);
    }
  }

  const note =
    support === 'ready' ? (subscribed ? t('settings.push.on') : t('settings.push.off')) : t(`settings.push.${support === 'no-key' ? 'noKey' : support}`);

  return (
    <div className="flex items-center gap-4 border-t border-line py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-medium">{t('settings.push.title')}</span>
        <span className="text-sm text-muted">{note}</span>
      </div>
      <Switch
        label={t('settings.push.title')}
        checked={subscribed && support === 'ready'}
        disabled={support !== 'ready' || config.isPending}
        busy={busy}
        onChange={(next) => void (busy ? undefined : next ? enable() : disable())}
      />
    </div>
  );
}
