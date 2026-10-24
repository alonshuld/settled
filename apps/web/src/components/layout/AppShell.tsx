import { Bell, Plus, Users, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { Avatar } from '@/components/ui/Avatar';
import { LogoMark } from '@/components/ui/Logo';
import { PrefControls } from '@/components/ui/PrefControls';
import { cn } from '@/lib/cn';
import { useSession } from '@/lib/auth';

const GROUP_PATHS = ['/groups', '/j/'];

function useActive() {
  const { pathname } = useLocation();
  return {
    groups: pathname === '/' || GROUP_PATHS.some((p) => pathname.startsWith(p)),
    activity: pathname.startsWith('/activity'),
    settings: pathname.startsWith('/settings'),
  };
}

function Brand() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-control">
      <LogoMark />
      <span className="text-xl font-bold tracking-tight">{t('brand')}</span>
    </Link>
  );
}

/** Header nav on desktop; bottom tab bar (Groups / Activity / + / Settings) below `md`, per the phone boards. */
export function AppShell() {
  const { t } = useTranslation();
  const active = useActive();
  const { data } = useSession();
  const name = data?.user.name || data?.user.email || '';

  const navItems = [
    { to: '/', label: t('nav.groups'), on: active.groups, Icon: Users },
    { to: '/activity', label: t('nav.activity'), on: active.activity, Icon: Bell },
  ];
  const settings = { to: '/settings', label: t('nav.settings'), on: active.settings, Icon: UserRound };

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-x-5 border-b border-line bg-surface px-4 py-2.5 md:px-8 md:py-3.5">
        <Brand />
        <nav aria-label={t('nav.main')} className="hidden gap-1 md:flex">
          {[...navItems, settings].map(({ to, label, on }) => (
            <Link
              key={to}
              to={to}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-[10px] px-3.5 font-medium',
                on ? 'bg-surface2 text-ink' : 'text-muted hover:text-ink',
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        <PrefControls />
        <Link to="/settings" aria-label={t('common.profile')} className="hidden rounded-full md:inline-flex">
          <Avatar name={name} self size={44} />
        </Link>
      </header>

      <main className="flex-1 pb-24 md:pb-0">
        <Outlet />
      </main>

      <nav
        aria-label={t('nav.main')}
        className="fixed inset-x-0 bottom-0 z-40 flex items-center border-t border-line bg-surface px-3 pt-1.5 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:hidden"
      >
        {[navItems[0]!, navItems[1]!].map(({ to, label, on, Icon }) => (
          <TabLink key={to} to={to} label={label} on={on} Icon={Icon} />
        ))}
        <Link
          to="/groups/new"
          aria-label={t('nav.newGroup')}
          className="-mt-6.5 flex size-15 flex-none items-center justify-center rounded-[20px] bg-accent text-accent-ink shadow-[0_8px_20px_rgba(0,0,0,.18)]"
        >
          <Plus size={26} strokeWidth={2.4} aria-hidden="true" />
        </Link>
        <TabLink to={settings.to} label={settings.label} on={settings.on} Icon={settings.Icon} />
      </nav>
    </div>
  );
}

function TabLink({ to, label, on, Icon }: { to: string; label: string; on: boolean; Icon: typeof Users }) {
  return (
    <Link
      to={to}
      aria-current={on ? 'page' : undefined}
      className={cn(
        'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium',
        on ? 'text-ink' : 'text-muted',
      )}
    >
      <Icon size={22} strokeWidth={on ? 2 : 1.8} aria-hidden="true" />
      {label}
    </Link>
  );
}
