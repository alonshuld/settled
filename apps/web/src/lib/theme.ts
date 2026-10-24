import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
export const THEME_KEY = 'settled.theme';
const listeners = new Set<() => void>();
const mql = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function isDark(pref: ThemePref) {
  return pref === 'dark' || (pref === 'system' && !!mql?.matches);
}

function apply() {
  document.documentElement.classList.toggle('dark', isDark(readTheme()));
  listeners.forEach((l) => l());
}

export function setTheme(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable */
  }
  apply();
}

mql?.addEventListener('change', apply);

export function useTheme() {
  const pref = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    readTheme,
  );
  return { pref, dark: isDark(pref), setTheme };
}
