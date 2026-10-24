import { TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorCode, errorMessage } from '@/lib/errors';
import { cn } from '@/lib/cn';
import { Button } from './Button';

/** Centered icon + title + body + optional action; the base of both state components. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  bare,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
  /** No dashed frame, for use inside a card. */
  bare?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 px-6 py-12 text-center',
        !bare && 'rounded-card border-2 border-dashed border-line',
        className,
      )}
    >
      {Icon && (
        <span className="inline-flex size-12 items-center justify-center rounded-full bg-surface2 text-ink">
          <Icon size={22} aria-hidden="true" />
        </span>
      )}
      <h2 className="text-lg font-semibold">{title}</h2>
      {body && <p className="max-w-sm text-muted">{body}</p>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2.5">{action}</div>}
    </div>
  );
}

/** A failed first load: message mapped from the error code, with a retry. */
export function ErrorState({
  error,
  onRetry,
  retrying,
  title,
  bare,
  action,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  title?: string;
  bare?: boolean;
  /** Extra action next to Retry. */
  action?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const offline = errorCode(error) === 'NETWORK';
  return (
    <div role="alert" className={className}>
      <EmptyState
        icon={offline ? WifiOff : TriangleAlert}
        title={title ?? (offline ? t('states.offlineTitle') : t('states.errorTitle'))}
        body={errorMessage(t, error)}
        bare={bare}
        action={
          (onRetry || action) && (
            <>
              {onRetry && (
                <Button variant="ghost" loading={retrying} onClick={onRetry}>
                  {t('common.retry')}
                </Button>
              )}
              {action}
            </>
          )
        }
      />
    </div>
  );
}
