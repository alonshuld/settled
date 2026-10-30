import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useSignOut } from '@/features/auth/useSignOut';
import { useDeleteAccountMutation, type Me } from '@/api/me';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { authClient, resetSessionData } from '@/lib/auth';
import { sectionCard } from './controls';
import { refreshSession } from './ProfileSection';

const WORD = 'DELETE';

export function AccountSection({ me }: { me: Me | undefined }) {
  const { t } = useTranslation();
  const [confirmOut, setConfirmOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { out, busy } = useSignOut();

  return (
    <section id="account" aria-labelledby="account-h" className={`${sectionCard} flex flex-wrap items-center gap-3`}>
      <div className="flex min-w-55 flex-1 flex-col gap-1">
        <h2 id="account-h" className="text-xl font-semibold">
          {t('settings.sections.account')}
        </h2>
        <span className="text-sm text-muted">{t('settings.accountSub')}</span>
      </div>
      <Button variant="ghost" loading={busy} onClick={() => (me?.isGuest ? setConfirmOut(true) : void out())}>
        {t('settings.signOut')}
      </Button>
      <Button variant="danger" onClick={() => setDeleting(true)}>
        {t('settings.delete')}
      </Button>
      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title={t('settings.signOutGuestTitle')}
        description={t('settings.signOutGuestBody')}
        confirmLabel={t('settings.signOut')}
        danger
        loading={busy}
        onConfirm={() => void out()}
      />
      {deleting && <DeleteDialog onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const del = useDeleteAccountMutation();
  const [typed, setTyped] = useState('');
  const ok = typed.trim().toUpperCase() === WORD;

  const submit = () => {
    if (!ok) return;
    del.mutate(undefined, {
      onSuccess: async () => {
        // The session row is gone with the account; clear the client side of it too
        try {
          await authClient.signOut();
        } catch {
          /* already invalid */
        }
        resetSessionData();
        refreshSession();
        navigate('/login', { replace: true });
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !del.isPending && onClose()}
      title={t('settings.deleteTitle')}
      description={t('settings.deleteBody')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={del.isPending} aria-disabled={!ok} onClick={submit}>
            {t('settings.deleteConfirm')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="delete-confirm" className="text-sm font-medium text-muted">
          {t('settings.deleteType', { word: WORD })}
        </label>
        <Input id="delete-confirm" dir="ltr" value={typed} autoComplete="off" autoCapitalize="characters" onChange={(e) => setTyped(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
