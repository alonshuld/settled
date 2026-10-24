import { useSyncExternalStore } from 'react';

/** Live `matchMedia` match; false where it is unavailable (tests). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== 'function') return () => {};
      const mql = matchMedia(query);
      mql.addEventListener('change', cb);
      return () => mql.removeEventListener('change', cb);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false),
    () => false,
  );
}
