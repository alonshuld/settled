import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/me';
import { PaymentDetailsCard } from '@/features/settle/PaymentDetailsCard';
import { cn } from '@/lib/cn';
import { AccountSection } from './AccountSection';
import { AppearanceSection } from './AppearanceSection';
import { NotificationsSection } from './NotificationsSection';
import { ProfileSection } from './ProfileSection';

const SECTIONS = ['profile', 'appearance', 'notifications', 'payment', 'account'] as const;
type Section = (typeof SECTIONS)[number];

/** Highlights the anchor whose section is nearest the top of the viewport. */
function useActiveSection(): Section {
  const [active, setActive] = useState<Section>('profile');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<Section>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id as Section);
          else visible.delete(e.target.id as Section);
        }
        const first = SECTIONS.find((s) => visible.has(s));
        if (first) setActive(first);
      },
      { rootMargin: '-96px 0px -55% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

export function Component() {
  const { t } = useTranslation();
  const me = useMe();
  const active = useActiveSection();

  const go = (id: Section) => (e: React.MouseEvent) => {
    e.preventDefault();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="mx-auto flex max-w-290 flex-wrap items-start gap-6 px-5 pt-6 pb-10 md:gap-8 md:px-8 md:pt-10 md:pb-14">
      <nav
        aria-label={t('nav.settings')}
        className="sticky top-0 z-10 -mx-5 flex min-w-0 flex-[1_1_100%] flex-col gap-1 bg-bg px-5 pb-2 md:static md:mx-0 md:bg-transparent md:p-0 lg:top-6 lg:sticky lg:flex-[1_1_200px] lg:max-w-60"
      >
        <h1 className="mb-2 text-[26px] font-bold tracking-tight md:text-4xl lg:mb-4">{t('nav.settings')}</h1>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:flex-col lg:overflow-visible">
          {SECTIONS.map((s) => (
            <a
              key={s}
              href={`#${s}`}
              onClick={go(s)}
              aria-current={active === s ? 'location' : undefined}
              className={cn(
                'inline-flex min-h-11 flex-none items-center rounded-[10px] px-3.5 font-medium whitespace-nowrap',
                active === s ? 'bg-surface2 text-ink' : 'text-muted hover:bg-surface2 hover:text-ink',
              )}
            >
              {t(`settings.sections.${s}`)}
            </a>
          ))}
        </div>
      </nav>

      <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
        <ProfileSection me={me} />
        <AppearanceSection me={me.data} />
        <NotificationsSection />
        <div id="payment" className="scroll-mt-24">
          <PaymentDetailsCard />
        </div>
        <AccountSection me={me.data} />
      </div>
    </div>
  );
}
