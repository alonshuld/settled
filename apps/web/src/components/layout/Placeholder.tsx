import { useTranslation } from 'react-i18next';

/** Stand-in body for routes whose screen has not been built yet; each feature page replaces its use. */
export function Placeholder({ title, detail }: { title: string; detail?: string }) {
  const { t } = useTranslation();
  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-3 px-5 pt-8 md:px-8 md:pt-10">
      <h1 className="text-3xl font-bold tracking-tight">{t(title)}</h1>
      {detail && (
        <p dir="ltr" className="text-start text-muted">
          {detail}
        </p>
      )}
      <p className="text-muted">{t('common.soon')}</p>
    </section>
  );
}
