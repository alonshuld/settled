import type { he } from './he';

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };

export const en: Widen<typeof he> = {
  brand: 'Settled',
  nav: { groups: 'Groups', activity: 'Activity', settings: 'Settings' },
  common: {
    switchLang: 'Switch to Hebrew',
    langShort: 'עב',
    toggleTheme: 'Toggle theme',
    profile: 'Profile',
    retry: 'Try again',
    cancel: 'Cancel',
    save: 'Save',
    close: 'Close',
  },
};
