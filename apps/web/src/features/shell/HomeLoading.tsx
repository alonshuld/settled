import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';
import { PrefControls } from '@/components/ui/PrefControls';
import { LogoMark } from '@/components/ui/Logo';

const card = 'rounded-card border border-line bg-surface';

/** Skeleton of the Home screen (HomeLoading / PhoneLoading boards) shown while the session resolves. */
export function HomeLoading() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="min-h-dvh bg-bg">
      <span role="status" className="sr-only">
        {t('splash.loadingGroups')}
      </span>

      <header className="hidden flex-wrap items-center gap-x-5 gap-y-3 border-b border-line bg-surface px-8 py-3.5 md:flex">
        <span className="flex items-center gap-2.5">
          <LogoMark />
          <span className="text-xl font-bold">{t('brand')}</span>
        </span>
        <div className="flex-1" />
        <PrefControls />
        <Skeleton className="size-11 rounded-full" />
      </header>

      <div className="flex flex-col gap-4.5 px-5 pt-6 md:mx-auto md:max-w-7xl md:gap-8 md:px-8 md:pt-10">
        <div className="flex items-center gap-2 md:items-end md:justify-between md:gap-5">
          <div className="flex flex-1 flex-col gap-2 md:flex-none md:gap-3">
            <Skeleton className="h-3 w-28 md:h-3.5 md:w-40" />
            <Skeleton className="h-6.5 w-38 md:h-9.5 md:w-60 md:rounded-[10px]" />
          </div>
          <div className="flex gap-2 md:hidden">
            <PrefControls />
          </div>
          <div className="hidden gap-2.5 md:flex">
            <Skeleton className="h-11 w-37.5 rounded-control" />
            <Skeleton className="h-11 w-35 rounded-control" />
          </div>
        </div>

        <div className={`${card} flex flex-col gap-3.5 p-5 md:hidden`}>
          <Skeleton className="h-3 w-2/5" />
          <Skeleton className="h-9.5 w-[55%] rounded-[10px]" />
          <div className="flex gap-2.5">
            <Skeleton className="h-13 flex-1 rounded-[14px]" />
            <Skeleton className="h-13 flex-1 rounded-[14px]" />
          </div>
        </div>
        <section className="hidden grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 md:grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`${card} flex flex-col gap-4 p-6`}>
              <Skeleton className="h-3.5 w-[45%]" />
              <Skeleton className="h-10 w-[60%] rounded-[10px]" />
              <Skeleton className="h-3 w-[70%]" />
            </div>
          ))}
        </section>

        <Skeleton className="h-4.5 w-30 md:hidden" />
        <div className="flex flex-col gap-2.5 md:hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
              <Skeleton className="size-11 flex-none rounded-[13px]" />
              <span className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-[65%]" />
                <Skeleton className="h-2.5 w-[40%]" />
              </span>
              <Skeleton className="h-4.5 w-14" />
            </div>
          ))}
        </div>

        <div className="hidden flex-wrap items-start gap-7 md:flex">
          <section className="flex min-w-0 flex-[999_1_560px] flex-col gap-4">
            <Skeleton className="h-5.5 w-35" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={`${card} flex flex-col gap-4.5 p-5.5`}>
                  <div className="flex items-center gap-3.5">
                    <Skeleton className="size-12 flex-none rounded-[14px]" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-3/5" />
                      <Skeleton className="h-3 w-2/5" />
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((j) => (
                      <Skeleton key={j} className="size-7.5 rounded-full" />
                    ))}
                  </div>
                  <div className="flex justify-between border-t border-line pt-4">
                    <Skeleton className="h-5.5 w-22" />
                    <Skeleton className="h-3 w-15" />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <aside className={`${card} min-w-0 flex-[1_1_320px] p-5.5`}>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-4.5 w-1/2" />
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-9 flex-none rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.75">
                    <Skeleton className="h-3 w-[85%]" />
                    <Skeleton className="h-2.5 w-[50%]" />
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 flex items-center justify-around border-t border-line bg-surface px-6 pt-3 pb-7 md:hidden">
        <Skeleton className="size-6.5 rounded-lg" />
        <Skeleton className="size-6.5 rounded-lg" />
        <Skeleton className="size-14 rounded-[18px]" />
        <Skeleton className="size-6.5 rounded-lg" />
      </div>
    </div>
  );
}
