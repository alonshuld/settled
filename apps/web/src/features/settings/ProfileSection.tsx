import { Check, User } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@/api/config';
import { useMe, useUpdateMeMutation, type Me } from '@/api/me';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { authClient, resetSessionData } from '@/lib/auth';
import { errorMessage } from '@/lib/errors';
import { toast } from '@/lib/toast';
import { sectionCard } from './controls';

/** Tells the Better Auth session store (header avatar, greeting) to refetch after a profile change. */
export function refreshSession() {
  try {
    authClient.$store.notify('$sessionSignal');
  } catch {
    /* the next session fetch picks it up */
  }
}

export function ProfileSection({ me }: { me: ReturnType<typeof useMe> }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);

  if (me.isPending) return <Skeleton id="profile" className="h-32 rounded-card" />;
  if (me.isError) return <ErrorState error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />;
  const u = me.data;

  const badge = u.isGuest
    ? t('settings.connectedGuest')
    : u.methods.google
      ? t('settings.connectedGoogle')
      : u.methods.email
        ? t('settings.connectedEmail')
        : null;

  return (
    <>
      <section id="profile" aria-label={t('settings.sections.profile')} className={`${sectionCard} flex flex-wrap items-center gap-5`}>
        <Avatar name={u.name} self size={72} />
        <div className="flex min-w-50 flex-1 flex-col gap-1">
          <span className="text-[22px] font-semibold wrap-anywhere">{u.name}</span>
          {u.email && (
            <span dir="ltr" className="text-start text-[15px] text-muted wrap-anywhere">
              {u.email}
            </span>
          )}
          {badge && (
            <span className="mt-1.5 inline-flex h-7 items-center gap-1.5 self-start rounded-full bg-pos-bg px-2.5 text-[13px] font-medium text-pos">
              {u.isGuest ? <User size={14} aria-hidden="true" /> : <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
              {badge}
            </span>
          )}
        </div>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          {t('settings.editProfile')}
        </Button>
      </section>
      {u.isGuest && <GuestBanner />}
      {editing && <NameDialog me={u} onClose={() => setEditing(false)} />}
    </>
  );
}

function GuestBanner() {
  const { t } = useTranslation();
  const config = useConfig();
  const [busy, setBusy] = useState(false);
  const google = config.data?.auth.google ?? false;

  // Better Auth links the guest to the Google account (or merges into an existing one) server-side.
  async function link() {
    setBusy(true);
    const res = await authClient.signIn.social({ provider: 'google', callbackURL: '/settings', errorCallbackURL: '/settings' });
    if (res.error) {
      setBusy(false);
      toast.warn(errorMessage(t, res.error));
    } else resetSessionData();
  }

  return (
    <section className="flex flex-wrap items-center gap-4 rounded-card border-[1.5px] border-dashed border-line px-6 py-5">
      <span className="inline-flex size-11 flex-none items-center justify-center rounded-full bg-surface2">
        <User size={20} aria-hidden="true" />
      </span>
      <div className="flex min-w-55 flex-1 flex-col gap-0.5">
        <span className="font-semibold">{t('settings.guestTitle')}</span>
        <span className="text-sm text-muted">{google ? t('settings.guestSub') : t('settings.googleUnavailable')}</span>
      </div>
      {google && (
        <Button loading={busy} onClick={() => void link()}>
          {t('settings.linkGoogle')}
        </Button>
      )}
    </section>
  );
}

function NameDialog({ me, onClose }: { me: Me; onClose: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(me.name);
  const update = useUpdateMeMutation();
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 60;

  const save = () => {
    if (!valid) return;
    if (trimmed === me.name) return onClose();
    update.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          refreshSession();
          toast.success(t('settings.nameSaved'));
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('settings.nameTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={update.isPending} aria-disabled={!valid} onClick={save}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor="profile-name" className="text-sm font-medium text-muted">
          {t('settings.nameLabel')}
        </label>
        <Input id="profile-name" value={name} maxLength={60} autoComplete="name" aria-invalid={!valid} onChange={(e) => setName(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
