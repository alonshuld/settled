import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@/components/ui/Button';
import { LogoMark } from '@/components/ui/Logo';
import { setLang, type Lang } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

// Placeholder shell until the router + screens land (see plan build order, step 2+).
export function App() {
  const { t, i18n } = useTranslation();
  const { dark, setTheme } = useTheme();
  const lang = i18n.language as Lang;
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-8 py-3.5">
      <LogoMark />
      <span className="text-xl font-bold">{t('brand')}</span>
      <div className="flex-1" />
      <IconButton onClick={() => setLang(lang === 'he' ? 'en' : 'he')} aria-label={t('common.switchLang')}>
        {t('common.langShort')}
      </IconButton>
      <IconButton onClick={() => setTheme(dark ? 'light' : 'dark')} aria-label={t('common.toggleTheme')}>
        {dark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
      </IconButton>
      <Button>{t('common.save')}</Button>
    </header>
  );
}
