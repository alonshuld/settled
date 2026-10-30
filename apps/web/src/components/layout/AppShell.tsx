import { Bell, LogOut, Plus, QrCode, Users, UserRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useActivityCounts } from '@/api/activity';
import { useMe } from '@/api/me';
import { Avatar } from '@/components/ui/Avatar';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { LogoMark } from '@/components/ui/Logo';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/Menu';
import { PrefControls } from '@/components/ui/PrefControls';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/auth';
import { useSignOut } from '@/features/auth/useSignOut';

const GROUP_PATHS = ['/groups'];

function useActive() {
  const { pathname } = useLocation();
  return {
    groups: pathname === '/' || GROUP_PATHS.some((p) => pathname.startsWith(p)),
    activity: pathname.startsWith('/activity'),
    join: pathname.startsWith('/join'),
    settings: pathname.startsWith('/settings'),
  };
}

function Brand() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="flex min-h-11 items-center gap-2.5 rounded-control">
      <LogoMark />
      <span className="text-xl font-bold tracking-tight">{t('brand')}</span>
    </Link>
  );
}

/** Header nav on desktop; bottom tab bar below `md`: Groups / Activity / + / Join / Settings, five equal slots so + sits in the middle. */
export function AppShell() {
  const { t } = useTranslation();
  const active = useActive();
  const { pathname } = useLocation();
  // The group page brings its own sticky Settle / Add bar on phone (PhoneGroup board).
  // The add/edit expense form is full-screen on phone: its own top bar and sticky save button.
  const focusPage = /^\/groups\/[^/]+\/expenses\/(new|[^/]+\/edit)\/?$/.test(pathname);
  const ownBottomBar = focusPage || /^\/groups\/(?!new\/?$)[^/]+\/?$/.test(pathname);
  const { data } = useSession();
  const name = data?.user.name || data?.user.email || '';
  const unread = useActivityCounts().data?.unread ?? 0;

  const navItems = [
    { to: '/', label: t('nav.groups'), on: active.groups, Icon: Users },
    { to: '/activity', label: t('nav.activity'), on: active.activity, Icon: Bell, badge: unread },
  ];
  const settings = { to: '/settings', label: t('nav.settings'), on: active.settings, Icon: UserRound, badge: 0 };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className={cn('flex items-center gap-x-5 border-b border-line bg-surface px-4 py-2.5 md:px-8 md:py-3.5', focusPage && 'max-md:hidden')}>
        <Brand />
        <nav aria-label={t('nav.main')} className="hidden gap-1 md:flex">
          {[...navItems, settings].map(({ to, label, on, badge }) => (
            <Link
              key={to}
              to={to}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 font-medium',
                on ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {label}
              <Badge count={badge} />
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <PrefControls />
        <UserMenu name={name} />
      </header>

      <main className="flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.main')}
        hidden={ownBottomBar}
        className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t border-line bg-surface px-3 pt-1.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {[navItems[0]!, navItems[1]!].map(({ to, label, on, Icon, badge }) => (
          <TabLink key={to} to={to} label={label} on={on} Icon={Icon} badge={badge} />
        ))}
        <div className="flex flex-1 justify-center">
          <Link
            to="/groups/new"
            aria-label={t('nav.newGroup')}
            className="-mt-6.5 flex size-15 flex-none items-center justify-center rounded-[20px] bg-accent text-accent-ink shadow-[0_8px_20px_rgba(0,0,0,.18)]"
          >
            <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
          </Link>
        </div>
        <TabLink to="/join" label={t('nav.join')} on={active.join} Icon={QrCode} />
        <TabLink to={settings.to} label={settings.label} on={settings.on} Icon={settings.Icon} />
      </nav>
    </div>
  );
}

/** Avatar menu: Settings and Sign out (guests confirm first, since their groups live only on this device). */
function UserMenu({ name }: { name: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { out, busy } = useSignOut();
  const [confirm, setConfirm] = useState(false);

  return (
    <>
      <Menu>
        <MenuTrigger aria-label={t('common.profile')} className="inline-flex cursor-pointer rounded-full">
          <Avatar name={name} self size={44} />
        </MenuTrigger>
        <MenuContent>
          <MenuLabel>{name}</MenuLabel>
          <MenuSeparator />
          <MenuItem onSelect={() => navigate('/settings')}>
            <UserRound size={18} aria-hidden="true" />
            {t('nav.settings')}
          </MenuItem>
          <MenuItem onSelect={() => (me?.isGuest ? setConfirm(true) : void out())}>
            <LogOut size={18} aria-hidden="true" className="rtl:-scale-x-100" />
            {t('settings.signOut')}
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('settings.signOutGuestTitle')}
        description={t('settings.signOutGuestBody')}
        confirmLabel={t('settings.signOut')}
        danger
        loading={busy}
        onConfirm={() => void out()}
      />
    </>
  );
}

function Badge({ count, floating }: { count?: number; floating?: boolean }) {
  const { t } = useTranslation();
  if (!count) return null;
  return (
    <span
      role="img"
      aria-label={t('activity.unreadBadge', { count })}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-neg px-1.5 text-[11px] font-bold text-bg',
        floating && 'absolute -top-1 start-1/2 ms-1.5',
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function TabLink({ to, label, on, Icon, badge }: { to: string; label: string; on: boolean; Icon: typeof Users; badge?: number }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
        on ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon size={22} strokeWidth={on ? 2 : 1.8} aria-hidden="true" />
      {label}
      <Badge count={badge} floating />
    </Link>
  );
}
