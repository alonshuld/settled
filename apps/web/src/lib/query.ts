import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@settled/api-client';
import { i18n } from './i18n';
import { errorCode, isTransient } from './errors';
import { toast } from './toast';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { silent?: boolean };
    queryMeta: { silent?: boolean };
  }
}

const retry = (failureCount: number, error: unknown) => failureCount < 2 && isTransient(error);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry, refetchOnWindowFocus: false },
  },
  queryCache: new QueryCache({
    // Only background failures of data we already show; first-load failures render their own error state.
    onError: (error, query) => {
      if (query.meta?.silent || query.state.data === undefined) return;
      if (error instanceof ApiError && error.isAuthError) return;
      toast.error(error, { label: i18n.t('common.retry'), onClick: () => void query.fetch() });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      if (errorCode(error) === 'UNAUTHENTICATED') return;
      toast.error(error);
    },
  }),
});
