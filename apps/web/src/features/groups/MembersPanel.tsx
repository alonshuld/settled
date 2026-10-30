import { LogOut, Lock, LockOpen, Pencil, Trash2, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
  useAddMemberMutation,
  useLeaveGroupMutation,
  useRemoveMemberMutation,
  useRenameMemberMutation,
  useSetClosedMutation,
  type GroupDetail,
  type GroupMemberView,
} from '@/api/groupDetail';
import { useConfig } from '@/api/config';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { cn } from '@/lib/cn';
import { parseMemberInput } from '@/lib/members';
import { toast } from '@/lib/toast';
import { activeMembers } from './members';

type Dlg =
  | { kind: 'add' }
  | { kind: 'rename'; member: GroupMemberView }
  | { kind: 'remove'; member: GroupMemberView }
  | { kind: 'leave' }
  | { kind: 'close' }
  | { kind: 'reopen' };

/**
 * Members list plus group-level actions. `card` frames it for the desktop sidebar; on phone the same
 * content sits inside a sheet.
 */
export function MembersPanel({ group, card }: { group: GroupDetail; card?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const close = () => setDlg(null);

  const add = useAddMemberMutation(group.id);
  const rename = useRenameMemberMutation(group.id);
  const remove = useRemoveMemberMutation(group.id);
  const leave = useLeaveGroupMutation(group.id);
  const setClosed = useSetClosedMutation(group.id);

  const members = activeMembers(group);
  const me = members.find((m) => m.isMe);
  const owner = me?.role === 'owner';
  const closed = !!group.closedAt;

  return (
    <section
      aria-labelledby={card ? 'members-h' : undefined}
      className={cn('flex flex-col gap-3', card && 'rounded-card border border-line bg-surface p-5.5')}
    >
      <div className="flex items-center gap-2">
        {card && (
          <h2 id="members-h" className="flex-1 text-base font-semibold">
            {t('group.members.title')} <span className="font-normal text-muted">({members.length})</span>
          </h2>
        )}
        {!card && <span className="flex-1 text-sm text-muted">{t('group.members.count', { count: members.length })}</span>}
        {!closed && (
          <Button variant="ghost" onClick={() => setDlg({ kind: 'add' })}>
            <UserPlus size={18} aria-hidden="true" />
            {t('group.members.add')}
          </Button>
        )}
      </div>

      <ul className="flex flex-col">
        {members.map((m) => {
          const canRename = m.isMe || m.isPlaceholder;
          return (
            <li key={m.id} className="flex min-h-14 items-center gap-3">
              <MemberAvatar name={m.displayName} color={m.color} size={36} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {m.displayName}
                  {m.isMe && <span className="ms-1 text-muted">{t('group.you')}</span>}
                </span>
                {(m.role === 'owner' || m.isPlaceholder) && (
                  <span className="text-xs text-muted">
                    {m.role === 'owner' ? t('group.members.owner') : t('group.members.notJoined')}
                  </span>
                )}
              </span>
              {canRename && !closed && (
                <IconButton
                  aria-label={`${t('group.members.rename')}: ${m.displayName}`}
                  className="border-0 bg-transparent"
                  onClick={() => setDlg({ kind: 'rename', member: m })}
                >
                  <Pencil size={17} aria-hidden="true" />
                </IconButton>
              )}
              {m.isPlaceholder && !closed && (
                <IconButton
                  aria-label={`${t('group.members.remove')}: ${m.displayName}`}
                  className="border-0 bg-transparent"
                  onClick={() => setDlg({ kind: 'remove', member: m })}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </IconButton>
              )}
            </li>
          );
        })}
      </ul>

      {me && (
        <div className="flex flex-col gap-2 border-t border-line pt-3.5">
          <span className="text-sm font-semibold text-muted">{t('group.members.actions')}</span>
          <div className="flex flex-wrap gap-2.5">
            {owner &&
              (closed ? (
                <Button variant="ghost" onClick={() => setDlg({ kind: 'reopen' })}>
                  <LockOpen size={18} aria-hidden="true" />
                  {t('group.members.reopen')}
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setDlg({ kind: 'close' })}>
                  <Lock size={18} aria-hidden="true" />
                  {t('group.members.close')}
                </Button>
              ))}
            {me && !owner && (
              <Button variant="danger" onClick={() => setDlg({ kind: 'leave' })}>
                <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
                {t('group.members.leave')}
              </Button>
            )}
          </div>
        </div>
      )}

      <AddDialog
        open={dlg?.kind === 'add'}
        onClose={close}
        loading={add.isPending}
        onSubmit={(body) =>
          add.mutate(body, {
            onSuccess: () => {
              close();
              toast.success(t('group.members.added'));
            },
          })
        }
      />
      <RenameDialog
        member={dlg?.kind === 'rename' ? dlg.member : null}
        onClose={close}
        loading={rename.isPending}
        onSubmit={(memberId, displayName) => rename.mutate({ memberId, displayName }, { onSuccess: close })}
      />
      <ConfirmDialog
        open={dlg?.kind === 'remove'}
        onOpenChange={(o) => !o && close()}
        danger
        title={t('group.members.removeTitle', { name: dlg?.kind === 'remove' ? dlg.member.displayName : '' })}
        description={t('group.members.removeBody')}
        confirmLabel={t('group.members.remove')}
        loading={remove.isPending}
        onConfirm={() =>
          dlg?.kind === 'remove' &&
          remove.mutate(dlg.member.id, {
            onSuccess: () => {
              close();
              toast.success(t('group.members.removed'));
            },
          })
        }
      />
      <ConfirmDialog
        open={dlg?.kind === 'leave'}
        onOpenChange={(o) => !o && close()}
        danger
        title={t('group.members.leaveTitle')}
        description={t('group.members.leaveBody')}
        confirmLabel={t('group.members.leave')}
        loading={leave.isPending}
        onConfirm={() =>
          leave.mutate(undefined, {
            onSuccess: () => {
              toast.success(t('group.members.left'));
              navigate('/', { replace: true });
            },
          })
        }
      />
      <ConfirmDialog
        open={dlg?.kind === 'close' || dlg?.kind === 'reopen'}
        onOpenChange={(o) => !o && close()}
        title={dlg?.kind === 'reopen' ? t('group.members.reopenTitle') : t('group.members.closeTitle')}
        description={dlg?.kind === 'reopen' ? t('group.members.reopenBody') : t('group.members.closeBody')}
        confirmLabel={dlg?.kind === 'reopen' ? t('group.members.reopen') : t('group.members.close')}
        loading={setClosed.isPending}
        onConfirm={() => {
          const closing = dlg?.kind === 'close';
          setClosed.mutate(closing, {
            onSuccess: () => {
              close();
              toast.success(closing ? t('group.members.closed') : t('group.members.reopened'));
            },
          });
        }}
      />
    </section>
  );
}

function AddDialog({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: NonNullable<ReturnType<typeof parseMemberInput>>) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const emailOn = useConfig().data?.auth.emailOtp ?? false;
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseMemberInput(value);
    setInvalid(!parsed);
    if (parsed) {
      onSubmit(parsed);
      setValue('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t('group.members.addTitle')} description={t(emailOn ? 'group.members.addHint' : 'group.members.addHintNoEmail')}>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(emailOn ? 'group.members.addPh' : 'group.members.addPhNoEmail')}
          aria-label={t(emailOn ? 'group.members.addPh' : 'group.members.addPhNoEmail')}
          aria-invalid={invalid || undefined}
          maxLength={120}
        />
        {invalid && <p role="alert" className="text-sm text-neg">{t('group.members.nameRequired')}</p>}
        <div className="flex justify-end">
          <Button type="submit" loading={loading}>
            {t('group.members.addSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  member,
  onClose,
  onSubmit,
  loading,
}: {
  member: GroupMemberView | null;
  onClose: () => void;
  onSubmit: (memberId: string, displayName: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!member} onOpenChange={(o) => !o && onClose()} title={t('group.members.renameTitle')}>
      {/* Keyed so the field restarts from the person's current name each time it opens. */}
      {member && <RenameForm key={member.id} member={member} onSubmit={onSubmit} loading={loading} />}
    </Dialog>
  );
}

function RenameForm({
  member,
  onSubmit,
  loading,
}: {
  member: GroupMemberView;
  onSubmit: (memberId: string, displayName: string) => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(member.displayName);
  const trimmed = name.trim();
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed) onSubmit(member.id, trimmed);
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t('group.members.nameLabel')}
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-invalid={!trimmed || undefined} />
      </label>
      {!trimmed && (
        <p role="alert" className="text-sm text-neg">
          {t('group.members.nameRequired')}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" loading={loading} disabled={!trimmed}>
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}
