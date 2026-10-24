import { useMutation } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { ApiError } from '@settled/api-client';
import { api, unwrap } from '@/lib/api';

export const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

// /config doesn't say whether receipt storage is configured, so the first 503 UPLOADS_UNAVAILABLE flips this
// for the rest of the session and the control disappears.
let unavailable = false;
const listeners = new Set<() => void>();
const markUnavailable = () => {
  if (unavailable) return;
  unavailable = true;
  listeners.forEach((l) => l());
};

export function useUploadsAvailable() {
  return !useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => unavailable,
  );
}

export const isReceiptType = (type: string): type is ReceiptType => (RECEIPT_TYPES as readonly string[]).includes(type);

interface PresignedUpload {
  key: string;
  uploadUrl: string;
  expiresAt: string;
}

/** Presign, then PUT straight to R2. Resolves to the object key to send as `receiptKey` on the expense. */
export function useUploadReceiptMutation(groupId: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const contentType = file.type as ReceiptType;
      let signed: PresignedUpload;
      try {
        signed = (await unwrap(
          api.POST('/uploads/receipts', { body: { groupId, contentType, size: file.size } }),
        )) as PresignedUpload;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'UPLOADS_UNAVAILABLE') markUnavailable();
        throw e;
      }
      // Content type and length are part of the signature, so they must match what was presigned.
      const res = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
      if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Receipt upload failed');
      return signed.key;
    },
  });
}
