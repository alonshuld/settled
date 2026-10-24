import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { setLang, type Lang } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { IconButton } from './Button';

/** Language + theme toggles shared by the app header, login, splash. */
export function PrefControls() {
  const { t, i18n } = useTranslation();
  const { dark, setTheme } = useTheme();
  const lang = i18n.language as Lang;
  return (
    <>
      <IconButton onClick={() => setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('common.switchLang')}>
        {t('common.langShort')}
      </IconButton>
      <IconButton onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={t('common.toggleTheme')}>
        {dark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
      </IconButton>
    </>
  );
}
