import { useTranslation } from 'react-i18next';
import { Skeleton } from '@/components/ui/Skeleton';

const card = 'rounded-card border border-line bg-surface';

export function GroupSkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy="true" className="mx-auto flex max-w-7xl flex-col gap-4 px-5 pt-3 pb-10 md:gap-6 md:px-8 md:pt-6">
      <span role="status" className="sr-only">
        {t('common.loading')}
      </span>
      <Skeleton className="h-11 w-24 rounded-control" />
      <div className="flex items-center gap-3.5 md:gap-5">
        <Skeleton className="size-14 rounded-[17px] md:size-18 md:rounded-[20px]" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-44 md:h-9 md:w-72" />
          <Skeleton className="h-3.5 w-32 md:w-56" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className={`h-18 rounded-2xl md:h-24 md:rounded-card ${i > 1 ? 'hidden md:block' : ''}`} />
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-6">
        <div className={`${card} flex min-w-0 flex-[999_1_560px] flex-col gap-3 p-5`}>
          <Skeleton className="h-10 w-48" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3.5 py-1.5">
              <Skeleton className="size-11 rounded-[13px]" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-2/3" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </div>
        <div className="hidden min-w-0 flex-[1_1_340px] flex-col gap-4 md:flex">
          <Skeleton className="h-64 rounded-card" />
          <Skeleton className="h-32 rounded-card" />
        </div>
      </div>
    </div>
  );
}
