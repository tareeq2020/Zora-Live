import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileStore } from '../storage/file-store.service';

/* KYC crypto + record helpers — direct port of server.js.
   SECURITY: documents live in data/kyc-private (outside any static root) and are
   encrypted at rest with AES-256-GCM. Key = SHA-256('kyc:' + session secret), so
   it matches the legacy oracle's key when they share a data dir (existing .enc
   docs stay decryptable). Blob = iv(12) | tag(16) | ciphertext. */
@Injectable()
export class KycService {
  readonly kycDir: string;
  private readonly key: Buffer;

  constructor(store: FileStore) {
    this.kycDir = path.join(store.dataDir, 'kyc-private');
    fs.mkdirSync(this.kycDir, { recursive: true });
    const secret = fs.readFileSync(path.join(store.dataDir, '.session-secret'), 'utf8');
    this.key = crypto.createHash('sha256').update('kyc:' + secret).digest();
  }

  docPath(id: string): string {
    return path.join(this.kycDir, id + '.enc');
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
