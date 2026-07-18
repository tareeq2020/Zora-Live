import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { SupabaseStorage } from '../storage/supabase-storage.service';
import { resolveKycSecret } from '../common/secret';

/* KYC crypto + record helpers.
   Documents are AES-256-GCM encrypted at rest and stored in a PRIVATE Supabase
   Storage bucket (kyc-private) — no public URL exists for an ID. Key = SHA-256
   ('kyc:' + KYC_SECRET). Blob = iv(12) | tag(16) | ciphertext. */
@Injectable()
export class KycService {
  private readonly key: Buffer;
  private readonly bucket = process.env.KYC_BUCKET || 'kyc-private';

  constructor(private readonly storage: SupabaseStorage) {
    const secret = resolveKycSecret(); // KYC_SECRET env
    this.key = crypto.createHash('sha256').update('kyc:' + secret).digest();
  }

  encrypt(buf: Buffer): Buffer {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), enc]);
  }

  decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]);
  }

  /** Encrypt the raw doc bytes and upload to the private bucket. */
  async store(id: string, raw: Buffer): Promise<void> {
    await this.storage.upload(this.bucket, id + '.enc', this.encrypt(raw));
  }

  /** Download + decrypt; null if the object does not exist. Throws on a decrypt failure. */
  async load(id: string): Promise<Buffer | null> {
    const enc = await this.storage.download(this.bucket, id + '.enc');
    return enc === null ? null : this.decrypt(enc);
  }

  async exists(id: string): Promise<boolean> {
    return (await this.storage.download(this.bucket, id + '.enc')) !== null;
  }

  // Shape sent to the admin queue — no raw storage internals, doc-number masked.
  public(v: any) {
    return {
      id: v.id, ref: v.ref, status: v.status, idType: v.idType, country: v.country,
      fullName: v.fullName, docNumberMasked: v.docNumberMasked || null,
      attempt: v.attempt, submittedAt: v.submittedAt, reviewedAt: v.reviewedAt,
      reviewedBy: v.reviewedBy, rejection: v.rejection,
      documents: (v.documents || []).map((d: any) => ({ id: d.id, side: d.side, contentType: d.contentType })),
      events: v.events || [],
    };
  }

  event(v: any, actor: string, action: string, detail?: string) {
    v.events = v.events || [];
    v.events.push({ at: new Date().toISOString(), actor, action, detail: detail || '' });
  }
}
