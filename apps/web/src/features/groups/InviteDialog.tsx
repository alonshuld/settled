import { Copy, RefreshCw, Share2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useInvite, useRotateInviteMutation, type GroupDetail, type InviteView } from '@/api/groupDetail';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { toast } from '@/lib/toast';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopy() {
  const { t } = useTranslation();
  return async (text: string) => {
    if (await copyText(text)) toast.success(t('group.inviteDlg.copied'));
    else toast.warn(t('group.inviteDlg.copyFailed'));
  };
}

/** Sidebar card (desktop): the link with a one-click copy, and a way into the full dialog. */
export function InviteCard({ group, onOpen }: { group: GroupDetail; onOpen: () => void }) {
  const { t } = useTranslation();
  const copy = useCopy();
  if (!group.invite) return null;
  const url = group.invite.url;
  return (
    <section aria-labelledby="invite-card-h" className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5.5">
      <h2 id="invite-card-h" className="text-base font-semibold">
        {t('group.inviteFriends')}
      </h2>
      <div className="flex items-center gap-2 rounded-control border border-line bg-surface2 p-1.5 ps-3.5">
        <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-sm text-muted">
          {url.replace(/^https?:\/\//, '')}
        </span>
        <Button variant="ghost" onClick={() => void copy(url)}>
          {t('group.inviteDlg.copy')}
        </Button>
      </div>
      <Button variant="text" className="self-start text-sm font-semibold" onClick={onOpen}>
        {t('group.inviteDlg.more')}
      </Button>
    </section>
  );
}

export function InviteDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const copy = useCopy();
  const q = useInvite(group.id, open, group.invite);
  const rotate = useRotateInviteMutation(group.id);
  const [confirm, setConfirm] = useState(false);
  const invite: InviteView | null | undefined = q.data ?? group.invite;
  const owner = group.members.some((m) => m.isMe && m.role === 'owner');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const share = () => {
    if (!invite) return;
    // AbortError is the user dismissing the sheet; nothing to report.
    navigator.share({ title: group.name, text: t('group.inviteDlg.shareText', { name: group.name }), url: invite.url }).catch(() => {});
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange} title={t('group.inviteFriends')} description={t('group.inviteDlg.sub')}>
        {group.closedAt ? (
          <p className="rounded-control bg-warn-bg px-4 py-3 text-[15px] font-medium text-warn">{t('group.inviteDlg.unavailable')}</p>
        ) : invite ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">{t('group.inviteDlg.code')}</span>
              <div className="flex items-center gap-2 rounded-control border border-line bg-surface2 p-1.5 ps-4">
                <span dir="ltr" className="flex-1 text-start text-2xl font-bold tracking-[0.18em]">
                  {invite.code}
                </span>
                <Button variant="ghost" onClick={() => void copy(invite.code)} aria-label={`${t('group.inviteDlg.copy')} ${t('group.inviteDlg.code')}`}>
                  <Copy size={16} aria-hidden="true" />
                  {t('group.inviteDlg.copy')}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-muted">{t('group.inviteDlg.link')}</span>
              <div className="flex items-center gap-2 rounded-control border border-line bg-surface2 p-1.5 ps-4">
                <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-sm">
                  {invite.url}
                </span>
                <Button variant="ghost" onClick={() => void copy(invite.url)} aria-label={`${t('group.inviteDlg.copy')} ${t('group.inviteDlg.link')}`}>
                  <Copy size={16} aria-hidden="true" />
                  {t('group.inviteDlg.copy')}
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {canShare && (
                <Button onClick={share}>
                  <Share2 size={18} aria-hidden="true" />
                  {t('group.inviteDlg.share')}
                </Button>
              )}
              {owner && (
                <Button variant="ghost" onClick={() => setConfirm(true)}>
                  <RefreshCw size={18} aria-hidden="true" />
                  {t('group.inviteDlg.rotate')}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('group.inviteDlg.rotateTitle')}
        description={t('group.inviteDlg.rotateBody')}
        confirmLabel={t('group.inviteDlg.rotate')}
        loading={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => {
              setConfirm(false);
              toast.success(t('group.inviteDlg.rotated'));
            },
          })
        }
      />
    </>
  );
}
