import { useSyncExternalStore } from 'react';
import { i18n } from './i18n';
import { errorMessage } from './errors';

export type ToastKind = 'error' | 'success' | 'warn';
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function dismissToast(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

function show(kind: ToastKind, message: string, action?: ToastItem['action']) {
  // Same message already on screen (e.g. several failed queries at once): keep one.
  if (items.some((i) => i.kind === kind && i.message === message)) return;
  const id = nextId++;
  items = [...items.slice(-2), { id, kind, message, action }];
  emit();
  setTimeout(() => dismissToast(id), action ? 8000 : 5000);
}

/** Imperative so it works from query/mutation caches, not just components. */
export const toast = {
  error: (err: unknown, action?: ToastItem['action']) => show('error', errorMessage(i18n.t.bind(i18n), err), action),
  success: (message: string) => show('success', message),
  warn: (message: string) => show('warn', message),
};

export function useToasts() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => items,
  );
}
