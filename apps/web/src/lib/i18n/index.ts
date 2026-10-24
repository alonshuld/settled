import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './en';
import { he } from './he';

export type Lang = 'he' | 'en';
export const LANG_KEY = 'settled.lang';

export function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'he';
  } catch {
    return 'he';
  }
}

/** Keeps <html lang/dir> in step with the active language. */
export function applyLang(lang: Lang) {
  const el = document.documentElement;
  el.lang = lang;
  el.dir = lang === 'he' ? 'rtl' : 'ltr';
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage unavailable: language still applies for this session */
  }
  applyLang(lang);
  void i18n.changeLanguage(lang);
}

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: readLang(),
  fallbackLng: 'he',
  interpolation: { escapeValue: false },
});

export { i18n };
