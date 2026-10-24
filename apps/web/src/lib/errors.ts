import { ApiError } from '@settled/api-client';
import type { TFunction } from 'i18next';
import { he } from './i18n/he';

export type ErrorCode = keyof typeof he.errors;

const isKnown = (code: string): code is ErrorCode => code in he.errors;

function codeFromStatus(status: number): ErrorCode {
  if (status === 0) return 'NETWORK';
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'INTERNAL';
  return 'UNKNOWN';
}

/**
 * Normalises whatever a call can throw (our ApiError, a Better Auth `{ code, message, status }` error,
 * or a fetch TypeError) to a key of the `errors.*` i18n dictionary.
 */
export function errorCode(err: unknown): ErrorCode {
  if (err instanceof ApiError) return isKnown(err.code) ? err.code : codeFromStatus(err.status);
  if (err instanceof TypeError) return 'NETWORK';
  if (err && typeof err === 'object') {
    const { code, status } = err as { code?: unknown; status?: unknown };
    if (typeof code === 'string' && isKnown(code)) return code;
    if (typeof status === 'number') return codeFromStatus(status);
  }
  return 'UNKNOWN';
}

export function errorMessage(t: TFunction, err: unknown): string {
  return t(`errors.${errorCode(err)}`);
}

/** Worth retrying automatically: offline, cold server, 5xx. */
export function isTransient(err: unknown): boolean {
  const code = errorCode(err);
  return code === 'NETWORK' || code === 'INTERNAL';
}
