import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/Button';

export function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-7xl flex-col items-start gap-4 px-5 pt-10 md:px-8">
      <h1 className="text-3xl font-bold tracking-tight">{t('common.notFound')}</h1>
      <Link to="/" className={buttonClass('ghost')}>
        {t('common.goHome')}
      </Link>
    </section>
  );
}
