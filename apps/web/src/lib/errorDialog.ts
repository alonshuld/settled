import { ApiError } from '@settled/api-client';
import { useSyncExternalStore } from 'react';
import { errorCode, type ErrorCode } from './errors';
import { i18n } from './i18n';
import { toast } from './toast';

export interface ErrorDialogState {
  code: ErrorCode;
  requestId?: string;
  /** Re-runs whatever failed; the dialog shows a primary "try again" only when present. */
  retry?: () => void | Promise<unknown>;
}

let current: ErrorDialogState | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Server hiccups and lost connections deserve a dialog (with a support id); validation-style errors stay inline/toast. */
export function wantsErrorDialog(err: unknown) {
  const code = errorCode(err);
  return code === 'NETWORK' || code === 'INTERNAL';
}

export function showErrorDialog(err: unknown, retry?: ErrorDialogState['retry']) {
  current = { code: errorCode(err), requestId: err instanceof ApiError ? err.requestId || undefined : undefined, retry };
  emit();
}

export function closeErrorDialog() {
  current = null;
  emit();
}

export function useErrorDialog() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => current,
  );
}

/** Server/connection failures open the error dialog (with retry when given); everything else is a toast. */
export function reportError(err: unknown, retry?: ErrorDialogState['retry']) {
  if (wantsErrorDialog(err)) showErrorDialog(err, retry);
  else toast.error(err, retry ? { label: i18n.t('common.retry'), onClick: () => void retry() } : undefined);
}
