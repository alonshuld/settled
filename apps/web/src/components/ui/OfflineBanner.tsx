import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOnline } from '@/lib/useOnline';

/** Persistent amber strip (Errors board "offline" toast) while the browser reports no connection. */
export function OfflineBanner() {
  const { t } = useTranslation();
  if (useOnline()) return null;
  return (
    <div
      role="status"
      className="sticky inset-x-0 top-0 z-60 flex min-h-11 items-center justify-center gap-2.5 bg-warn-bg px-4 py-2 text-sm font-medium text-warn"
    >
      <WifiOff size={18} aria-hidden="true" className="flex-none" />
      {t('errorDialog.offlineBanner')}
    </div>
  );
}
