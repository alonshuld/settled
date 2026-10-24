import { Check, Plane } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

const rows = [
  { from: 'bg-av-2', fromI: 'נ', fromEn: 'N', key: 'login.demo1', amount: '₪900' },
  { from: 'bg-av-3', fromI: 'א', fromEn: 'I', key: 'login.demo2', amount: '₪900' },
  { from: 'bg-av-4', fromI: 'מ', fromEn: 'M', key: 'login.demo3', amount: '₪500' },
] as const;

function DemoRow({ row, compact }: { row: (typeof rows)[number]; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === 'he';
  const size = compact ? 'size-7 text-xs' : 'size-8 text-[13px]';
  return (
    <div className={cn('flex items-center gap-2.5 rounded-[14px] bg-[#1c2128]', compact ? 'px-3 py-2.5' : 'p-3')}>
      <span className={cn('inline-flex flex-none items-center justify-center rounded-full font-semibold text-accent-ink', size, row.from)}>
        {he ? row.fromI : row.fromEn}
      </span>
      <span className={cn('flex-1 text-[#c9ced6]', compact ? 'text-[13px]' : 'text-sm')}>{t(row.key)}</span>
      <span dir="ltr" className={cn('font-semibold', compact ? 'text-sm' : 'text-base')}>
        {row.amount}
      </span>
    </div>
  );
}

function HeroStamp({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'absolute flex -rotate-[9deg] items-center gap-2 border-[3px] border-accent bg-hero font-extrabold text-accent',
        className,
      )}
    >
      {t('splash.stamp')}
      <Check size={22} strokeWidth={3} aria-hidden="true" />
    </div>
  );
}

/** Compact dark card for phones/tablets (PhoneLogin board). */
export function LoginHeroCompact() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-60 overflow-hidden rounded-hero border border-hero-line bg-hero p-4.5 text-[#f2f3f5]">
        <div className="absolute inset-x-4.5 top-5 flex flex-col gap-2">
          {rows.map((r) => (
            <DemoRow key={r.key} row={r} compact />
          ))}
        </div>
        <HeroStamp className="end-4 bottom-4.5 rounded-xl px-3.5 py-1 text-2xl" />
      </div>
      <h1 className="mt-4 text-[30px] leading-[1.1] font-bold tracking-tight">{t('login.h1')}</h1>
      <p className="text-[15px] leading-normal text-muted">{t('login.sub')}</p>
    </div>
  );
}

/** Large marketing panel for wide screens (Main board). */
export function LoginHeroWide() {
  const { t } = useTranslation();
  return (
    <section className="flex min-w-0 flex-1 flex-col justify-between gap-12 overflow-hidden rounded-hero border border-[#1f242b] bg-hero p-14 text-[#f2f3f5]">
      <div className="flex max-w-140 flex-col gap-5">
        <span className="inline-flex h-8 items-center self-start rounded-full bg-[#1c2128] px-3.5 text-sm font-medium text-accent">
          {t('login.chip')}
        </span>
        <h1 className="text-[56px] leading-[1.05] font-bold tracking-[-0.02em]">{t('login.h1')}</h1>
        <p className="text-[19px] leading-[1.55] text-hero-muted">{t('login.sub')}</p>
      </div>
      <div className="relative w-full max-w-115">
        <div className="flex flex-col gap-3.5 rounded-[22px] border border-[#262c35] bg-[#161a20] p-5.5">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-10 items-center justify-center rounded-control bg-av-3 text-accent-ink">
              <Plane size={20} aria-hidden="true" />
            </span>
            <div className="flex flex-col">
              <span className="text-base font-semibold">{t('login.demoGroup')}</span>
              <span className="text-[13px] text-hero-muted">{t('login.demoMeta')}</span>
            </div>
          </div>
          {rows.map((r) => (
            <DemoRow key={r.key} row={r} />
          ))}
        </div>
        <HeroStamp className="-end-4.5 -bottom-5.5 rounded-[14px] px-4.5 py-1.5 text-[30px]" />
      </div>
    </section>
  );
}
