import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors';

export const RECEIPT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_S = 15 * 60;
const VIEW_TTL_S = 15 * 60;

/** Receipts live in a private R2 bucket and are only reachable through short-lived signed URLs (design §9.6, §11.1). */
@Injectable()
export class ReceiptsService {
  private client: S3Client | null | undefined;

  constructor(private readonly config: ConfigService) {}

  private s3() {
    if (this.client === undefined) {
      const account = this.config.get<string>('R2_ACCOUNT_ID');
      const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
      const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
      this.client =
        account && accessKeyId && secretAccessKey
          ? new S3Client({
              region: 'auto',
              endpoint: `https://${account}.r2.cloudflarestorage.com`,
              credentials: { accessKeyId, secretAccessKey },
            })
          : null;
    }
    return this.client;
  }

  private bucket() {
    return this.config.get<string>('R2_BUCKET');
  }

  get enabled() {
    return Boolean(this.s3() && this.bucket());
  }

  /** `receipts/<groupId>/<id>.<ext>`: expenses reject keys from another group. */
  keyBelongsTo(key: string, groupId: string) {
    return key.startsWith(`receipts/${groupId}/`) && !key.slice(`receipts/${groupId}/`.length).includes('/');
  }

  async presignUpload(groupId: string, contentType: string, size: number) {
    const client = this.s3();
    const Bucket = this.bucket();
    if (!client || !Bucket) throw new AppError('UPLOADS_UNAVAILABLE', 503, 'Receipt storage is not configured');
    const ext = RECEIPT_TYPES[contentType]!;
    const key = `receipts/${groupId}/${crypto.randomUUID()}.${ext}`;
    // Content type and length are part of the signature, so the client cannot upload anything else
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size }),
      { expiresIn: UPLOAD_TTL_S },
    );
    return { key, uploadUrl, expiresAt: new Date(Date.now() + UPLOAD_TTL_S * 1000).toISOString() };
  }

  /** Signed view URL, or null when storage is not configured or the expense has no receipt. */
  async viewUrl(key: string | null): Promise<string | null> {
    const client = this.s3();
    const Bucket = this.bucket();
    if (!key || !client || !Bucket) return null;
    return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: VIEW_TTL_S });
  }

  /**
   * Deletes receipt objects older than `olderThanMs` that no expense points to (design §9.6).
   * `referenced` answers which of the given keys are still in use.
   */
  async deleteOrphans(referenced: (keys: string[]) => Promise<Set<string>>, olderThanMs: number): Promise<number> {
    const client = this.s3();
    const Bucket = this.bucket();
    if (!client || !Bucket) return 0;
    const cutoff = Date.now() - olderThanMs;
    let deleted = 0;
    let ContinuationToken: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: 'receipts/', ContinuationToken }));
      const old = (page.Contents ?? []).filter((o) => o.Key && o.LastModified && o.LastModified.getTime() < cutoff).map((o) => o.Key!);
      if (old.length > 0) {
        const used = await referenced(old);
        const orphans = old.filter((k) => !used.has(k));
        if (orphans.length > 0) {
          await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: orphans.map((Key) => ({ Key })), Quiet: true } }));
          deleted += orphans.length;
        }
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return deleted;
  }
}
