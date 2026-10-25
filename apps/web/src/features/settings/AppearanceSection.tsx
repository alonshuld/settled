import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCurrencies } from '@/api/groups';
import { useUpdateMeMutation, type Me } from '@/api/me';
import { inputClass } from '@/components/ui/Input';
import { setLang, type Lang } from '@/lib/i18n';
import { useTheme, type ThemePref } from '@/lib/theme';
import { Segmented, sectionCard } from './controls';

/** Theme and language apply (and persist) locally at once; the server copy is best effort. */
export function AppearanceSection({ me }: { me: Me | undefined }) {
  const { t, i18n } = useTranslation();
  const { pref, setTheme } = useTheme();
  const sync = useUpdateMeMutation({ silent: true });
  const currency = useUpdateMeMutation();
  const currencies = useCurrencies();
  const lang = i18n.language as Lang;
  const icon = { size: 16, 'aria-hidden': true } as const;

  const codes = currencies.data?.map((c) => c.code) ?? [];
  const current = me?.defaultCurrency;
  if (current && !codes.includes(current)) codes.push(current);

  return (
    <section id="appearance" aria-labelledby="appearance-h" className={`${sectionCard} flex flex-col gap-5.5`}>
      <h2 id="appearance-h" className="text-xl font-semibold">
        {t('settings.sections.appearance')}
      </h2>
      <div className="flex flex-wrap gap-5">
        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <span className="text-sm font-medium text-muted">{t('settings.theme')}</span>
          <Segmented<ThemePref>
            label={t('settings.theme')}
            value={pref}
            options={[
              { value: 'light', label: <><Sun {...icon} />{t('settings.light')}</> },
              { value: 'dark', label: <><Moon {...icon} />{t('settings.dark')}</> },
              { value: 'system', label: <><Monitor {...icon} />{t('settings.system')}</> },
            ]}
            onChange={(v) => {
              setTheme(v);
              if (me) sync.mutate({ theme: v });
            }}
          />
        </div>
        <div className="flex min-w-60 flex-1 flex-col gap-2">
          <span className="text-sm font-medium text-muted">{t('settings.language')}</span>
          <Segmented<Lang>
            label={t('settings.language')}
            value={lang}
            options={[
              { value: 'he', label: 'עברית', lang: 'he' },
              { value: 'en', label: 'English', lang: 'en' },
            ]}
            onChange={(v) => {
              setLang(v);
              if (me) sync.mutate({ locale: v });
            }}
          />
        </div>
      </div>
      <div className="flex max-w-80 flex-col gap-2">
        <label htmlFor="default-currency" className="text-sm font-medium text-muted">
          {t('settings.currency')}
        </label>
        <select
          id="default-currency"
          dir="ltr"
          className={`${inputClass} text-start`}
          disabled={!me || codes.length === 0}
          value={current ?? ''}
          onChange={(e) => currency.mutate({ defaultCurrency: e.target.value })}
        >
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-[13px] text-muted">{t('settings.currencyHint')}</span>
      </div>
    </section>
  );
}
