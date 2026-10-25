import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMatches } from 'react-router';

export interface RouteHandle {
  /** i18n key of the page title. */
  title?: string;
}

/** Keeps `document.title` in step with the active route and language ("Page · Brand"). */
export function TitleSync() {
  const { t, i18n } = useTranslation();
  const key = [...useMatches()].reverse().find((m) => (m.handle as RouteHandle | undefined)?.title)?.handle as RouteHandle | undefined;
  useEffect(() => {
    document.title = key?.title ? `${t(key.title)} · ${t('brand')}` : t('brand');
  }, [key?.title, t, i18n.language]);
  return null;
}
