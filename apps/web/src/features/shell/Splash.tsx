import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { PrefControls } from '@/components/ui/PrefControls';
import { Stamp } from '@/components/ui/Stamp';
import { cn } from '@/lib/cn';

const WAKING_AFTER_MS = 5000;

/** Fires `true` once `ms` has elapsed since mount. */
function useElapsed(ms: number) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDone(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return done;
}

/**
 * Boot screen (Splash / PhoneSplash boards) while `/config` and the session resolve. Free hosting means a
 * cold API can take up to a minute, so after ~5 s we say so instead of looking frozen. Hidden for the first
 * 200 ms so a fast boot never flashes it.
 */
export function Splash({ failed, onRetry }: { failed?: boolean; onRetry?: () => void }) {
  const { t } = useTranslation();
  const visible = useElapsed(200);
  const waking = useElapsed(WAKING_AFTER_MS);
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => n + 1), 1800);
    return () => clearInterval(id);
  }, []);
  const messages = [t('splash.m1'), t('splash.m2'), t('splash.m3'), t('splash.m4')];

  return (
    <div className={cn('flex min-h-dvh flex-col bg-bg transition-opacity duration-200', visible || failed ? 'opacity-100' : 'opacity-0')}>
      <div className="flex justify-end gap-2 px-4 py-4 md:px-8 md:py-5">
        <PrefControls />
      </div>
      <div role="status" aria-live="polite" className="flex flex-1 flex-col items-center justify-center gap-10 p-8 md:gap-12">
        <div className="relative flex h-40 w-full max-w-105 items-center justify-center md:h-55">
          {!failed && (
            <span className="absolute h-28 w-56 animate-splash-ring rounded-[34px] border-[3px] border-ink motion-reduce:hidden md:h-37.5 md:w-75 md:rounded-[40px] dark:border-accent" />
          )}
          <Stamp
            iconSize={46}
            className={cn(
              'rounded-[22px] border-[6px] border-ink px-6 pt-2 pb-3 text-[60px] leading-none text-ink md:rounded-[26px] md:border-[7px] md:px-8.5 md:pt-3 md:pb-4 md:text-[92px] dark:border-accent dark:text-accent',
              !failed && 'animate-splash-stamp motion-reduce:animate-none',
            )}
          >
            {t('splash.stamp')}
          </Stamp>
        </div>
        {failed ? (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <h1 className="text-xl font-bold">{t('splash.failedTitle')}</h1>
            <p className="text-muted">{t('splash.failedBody')}</p>
            <Button onClick={onRetry}>{t('common.retry')}</Button>
          </div>
        ) : (
          <div className="flex w-70 max-w-full flex-col items-center gap-4.5">
            <span key={i} className="animate-fade-up text-base font-medium text-muted md:text-lg">
              {messages[i % messages.length]}
            </span>
            <span className="relative h-1.5 w-full overflow-hidden rounded-full bg-line">
              <span className="absolute inset-y-0 w-2/5 animate-splash-bar rounded-full bg-accent motion-reduce:start-0 motion-reduce:animate-none" />
            </span>
            {waking && <p className="animate-fade-up text-center text-sm text-muted">{t('splash.waking')}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
