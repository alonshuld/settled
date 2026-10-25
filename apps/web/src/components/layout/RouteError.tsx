import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useRouteError } from 'react-router';
import { Button, buttonClass } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';

/** Last-resort screen for render errors and failed lazy chunks (e.g. a stale tab after a deploy). */
export function RouteError() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (import.meta.env.DEV) console.error(error);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg px-5 text-center">
      <LogoMark size={48} />
      <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-[14px] bg-neg-bg text-neg">
        <CircleAlert size={24} />
      </span>
      <h1 className="text-2xl font-bold">{t('titles.error')}</h1>
      <p className="max-w-sm text-muted">{t('errorDialog.routeBody')}</p>
      <div className="flex gap-2.5">
        <Link to="/" reloadDocument className={buttonClass('ghost')}>
          {t('common.goHome')}
        </Link>
        <Button onClick={() => location.reload()}>{t('common.retry')}</Button>
      </div>
    </div>
  );
}
