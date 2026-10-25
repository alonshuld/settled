import { Outlet } from 'react-router';
import { useConfig } from '@/api/config';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { TitleSync } from '@/components/layout/TitleSync';
import { Splash } from '@/features/shell/Splash';
import { ErrorDialog } from '@/components/ui/ErrorDialog';
import { ToastViewport } from '@/components/ui/Toast';

/**
 * Root route. `/config` is the first call, so it also wakes a sleeping free-tier API: show the splash
 * (with its "waking up" hint) until it answers, and a retry screen if the backoff is exhausted.
 */
export function Boot() {
  const config = useConfig();
  return (
    <>
      <OfflineBanner />
      {config.data ? <Outlet /> : <Splash failed={config.isError} onRetry={() => void config.refetch()} />}
      <TitleSync />
      <ToastViewport />
      <ErrorDialog />
    </>
  );
}
