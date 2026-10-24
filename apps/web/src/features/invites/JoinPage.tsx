import { ApiError } from '@settled/api-client';
import { formatInviteCode, parseInviteCode } from '@settled/core';
import { Plus, QrCode } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useInvitePreview, useJoinMutation, type InvitePreview } from '@/api/groups';
import { qk } from '@/api/keys';
import { Button, buttonClass } from '@/components/ui/Button';
import { GroupTypeIcon } from '@/components/ui/GroupTypeIcon';
import { Input } from '@/components/ui/Input';
import { LogoMark } from '@/components/ui/Logo';
import { MemberAvatar } from '@/components/ui/MemberAvatar';
import { PrefControls } from '@/components/ui/PrefControls';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/States';
import { useSession } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { errorCode, isTransient } from '@/lib/errors';
import { formatDateRange, formatMoney, type Lang } from '@/lib/format';
import { queryClient } from '@/lib/query';
import { loginPath } from '@/lib/nav';

const NEW = 'new';
const card = 'rounded-card border border-line bg-surface';

/** Public route: previews the invite signed out, and sends the visitor through /login and back to join. */
export function Component() {
  const { t } = useTranslation();
  const { code: param } = useParams();
  const code = param ? parseInviteCode(param) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 px-5 py-4 md:px-8 md:py-5">
        <Link to="/" className="flex items-center gap-2.5 rounded-control">
          <LogoMark />
          <span className="text-xl font-bold tracking-tight">{t('brand')}</span>
        </Link>
        <div className="flex-1" />
        <PrefControls />
      </header>

      <main className="mx-auto flex w-full max-w-280 flex-1 flex-wrap items-start gap-6 px-5 pt-2 pb-12 md:px-8 md:pt-4">
        {param ? (
          <section aria-live="polite" className={cn(card, 'flex min-w-0 flex-[999_1_520px] flex-col gap-7 p-6 md:p-9')}>
            {code ? <Invite code={code} /> : <BadInvite error={new ApiError(404, 'INVITE_NOT_FOUND', '')} onRetry={() => {}} />}
          </section>
        ) : null}
        <CodeEntry initial={param ?? ''} wide={!param} />
      </main>
    </div>
  );
}

function Invite({ code }: { code: string }) {
  const preview = useInvitePreview(code);
  if (preview.isPending) return <InviteSkeleton />;
  if (preview.isError) return <BadInvite error={preview.error} retrying={preview.isFetching} onRetry={() => void preview.refetch()} />;
  return <InviteCard code={code} data={preview.data} />;
}

function InviteSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="flex flex-col gap-7">
      <span role="status" className="sr-only">
        {t('common.loading')}
      </span>
      <div className="flex items-center gap-3.5">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-56 rounded-[10px]" />
        </div>
      </div>
      <Skeleton className="h-28 w-full rounded-card" />
      <Skeleton className="h-14 w-full rounded-control" />
    </div>
  );
}

function BadInvite({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  const { t } = useTranslation();
  const retryable = isTransient(error);
  return (
    <ErrorState
      bare
      title={t('join.badTitle')}
      error={error}
      retrying={retrying}
      onRetry={retryable ? onRetry : undefined}
      action={
        <Link to="/" className={buttonClass('ghost')}>
          {t('common.goHome')}
        </Link>
      }
    />
  );
}

function InviteCard({ code, data }: { code: string; data: InvitePreview }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language as Lang;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { data: session, isPending: sessionPending } = useSession();
  const join = useJoinMutation(code);

  const { group, invitedBy, claimable } = data;
  const claimParam = params.get('claim');
  const initial =
    claimParam === NEW ? NEW : claimable.some((c) => c.memberId === claimParam) ? claimParam : null;
  const [sel, setSel] = useState<string | null>(initial);
  const choose = claimable.length > 0;
  const chosen = claimable.find((c) => c.memberId === sel);
  const ready = !choose || sel !== null;

  const meta = [
    formatDateRange(group.startDate, group.endDate, lang),
    t('home.members', { count: group.memberCount }),
    t('join.expenses', { count: group.expenseCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  function go() {
    if (!ready) return;
    if (!session) {
      const back = `/j/${formatInviteCode(code)}${sel ? `?claim=${encodeURIComponent(sel)}` : ''}`;
      navigate(loginPath(back));
      return;
    }
    join.mutate(chosen?.memberId, {
      onSuccess: (r) => navigate(`/groups/${r.groupId}`, { replace: true }),
      onError: (err) => {
        if (errorCode(err) === 'MEMBER_ALREADY_CLAIMED') {
          setSel(null);
          void queryClient.invalidateQueries({ queryKey: qk.invites.byCode(code) });
        }
      },
    });
  }

  return (
    <>
      <div className="flex items-center gap-3.5">
        {invitedBy ? (
          <MemberAvatar name={invitedBy.name} color={invitedBy.color} size={48} />
        ) : (
          <LogoMark />
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] text-muted">
            {invitedBy ? t('join.invitedBy', { name: invitedBy.name }) : t('join.invited')}
          </span>
          <h1 className="text-[26px] font-bold tracking-tight md:text-3xl">{t('join.title')}</h1>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-5 rounded-card border border-line bg-surface2 p-5">
        <GroupTypeIcon type={group.type} size={64} />
        <div className="flex min-w-44 flex-1 flex-col gap-1">
          <span className="text-[22px] font-semibold">{group.name}</span>
          <span className="text-[15px] text-muted">{meta}</span>
        </div>
        <div className="flex flex-col gap-0.5 md:items-end">
          <span className="text-[13px] text-muted">{t('join.spent')}</span>
          <span className="text-[22px] font-bold">{formatMoney(group.totalSpent, group.currency, lang)}</span>
        </div>
      </div>

      {choose && (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold">{t('join.whoAreYou')}</legend>
          <p className="-mt-1 mb-1 text-sm text-muted">{t('join.whoHint')}</p>
          <div className="flex flex-wrap gap-2.5">
            {claimable.map((c) => (
              <WhoButton key={c.memberId} on={sel === c.memberId} onClick={() => setSel(c.memberId)}>
                <MemberAvatar name={c.displayName} color={c.color} size={36} />
                {c.displayName}
              </WhoButton>
            ))}
            <WhoButton on={sel === NEW} onClick={() => setSel(NEW)}>
              <span className="inline-flex size-9 items-center justify-center rounded-full bg-tint-other text-accent-ink">
                <Plus size={16} aria-hidden="true" />
              </span>
              {t('join.newPerson')}
            </WhoButton>
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-3 border-t border-line pt-6">
        <Button size="lg" loading={join.isPending || sessionPending} disabled={!ready} onClick={go}>
          {session ? (join.isPending ? t('join.joining') : chosen ? t('join.joinAs', { name: chosen.displayName }) : t('join.join')) : t('join.signIn')}
        </Button>
        {!session && !sessionPending && <p className="text-center text-[13px] text-muted">{t('join.signInNote')}</p>}
      </div>
    </>
  );
}

function WhoButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex min-h-13 cursor-pointer items-center gap-2.5 rounded-full border-[1.5px] py-1 ps-1 pe-4 text-[15px] font-medium',
        on ? 'border-ink bg-surface shadow-[0_0_0_1px_var(--ink)]' : 'border-line bg-surface2 hover:border-muted',
      )}
    >
      {children}
    </button>
  );
}

function CodeEntry({ initial, wide }: { initial: string; wide: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = parseInviteCode(value);
    if (!code) return setError(true);
    setError(false);
    navigate(`/j/${formatInviteCode(code)}`);
  }

  return (
    <aside className={cn('flex min-w-0 flex-col gap-4', wide ? 'mx-auto w-full max-w-md' : 'flex-[1_1_340px]')}>
      <form onSubmit={submit} noValidate className={cn(card, 'flex flex-col gap-4.5 p-6 md:p-7')}>
        <h2 className="text-xl font-semibold">{wide ? t('join.title') : t('join.codeTitle')}</h2>
        <p className="text-sm leading-normal text-muted">{t('join.codeSub')}</p>
        <label htmlFor="invite-code" className="sr-only">
          {t('join.codeLabel')}
        </label>
        <Input
          id="invite-code"
          dir="ltr"
          value={value}
          autoFocus={wide}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          placeholder="KR7-4QX"
          aria-invalid={error}
          aria-describedby={error ? 'invite-code-err' : undefined}
          onChange={(e) => {
            setValue(e.target.value.toUpperCase());
            setError(false);
          }}
          className="text-center text-2xl font-semibold tracking-[0.2em] placeholder:tracking-[0.2em]"
        />
        {error && (
          <p id="invite-code-err" role="alert" className="text-sm text-neg">
            {t('join.codeInvalid')}
          </p>
        )}
        <Button type="submit" variant="ghost">
          {t('join.find')}
        </Button>
      </form>
      <div className={cn(card, 'flex items-center gap-4 p-6')}>
        <span className="inline-flex size-12 flex-none items-center justify-center rounded-[14px] bg-surface2">
          <QrCode size={22} aria-hidden="true" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{t('join.scan')}</span>
          <span className="text-sm text-muted">{t('join.scanSub')}</span>
        </div>
      </div>
    </aside>
  );
}
