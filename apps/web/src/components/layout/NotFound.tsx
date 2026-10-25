import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/Button';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center gap-5 px-5 pt-16 text-center md:pt-24">
      <span dir="ltr" aria-hidden="true" className="-rotate-6 rounded-[18px] border-4 border-line px-5 py-1 text-5xl font-extrabold text-muted">
        404
      </span>
      <h1 className="text-3xl font-bold tracking-tight">{t('common.notFound')}</h1>
      <p className="text-muted">{t('errorDialog.notFoundBody')}</p>
      <Link to="/" className={buttonClass('primary')}>
        {t('common.goHome')}
      </Link>
    </section>
  );
}
