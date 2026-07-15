import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { KycService } from './kyc.service';
import { ID_TYPES, KYC_REASONS } from '../common/defaults';

@Controller()
export class KycController {
  constructor(private readonly store: FileStore, private readonly kyc: KycService, private readonly audit: AuditService) {}

  // Step 1 — receive one document, encrypt, store privately, return an opaque docId.
  // (Open in the demo like /api/upload; gate to the authenticated user in production.)
  @Post('kyc/upload')
  upload(@Body() body: any) {
    const { dataUrl } = body || {};
    const m = /^data:(image\/(?:jpe?g|png|webp)|application\/pdf);base64,/.exec(dataUrl || '');
    if (!m) throw new BadRequestException({ error: 'Upload a JPG, PNG, WEBP or PDF' });
    const contentType = m[1];
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (!buf.length) throw new BadRequestException({ error: 'Empty file' });
    if (buf.length > 8 * 1024 * 1024) throw new BadRequestException({ error: 'File is over 8MB' });
    const docId = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(this.kyc.docPath(docId), this.kyc.encrypt(buf));
    return { ok: true, docId, contentType, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  }

  // Step 2 — create the verification record from the uploaded docIds.
  @Post('kyc/submit')
  submit(@Body() body: any, @Req() req: Request) {
    const { idType, country, fullName, docNumber, documents } = body || {};
    if (!ID_TYPES.includes(idType)) throw new BadRequestException({ error: 'Choose a valid ID type' });
    if (!country) throw new BadRequestException({ error: 'Select your country' });
    if (!fullName || String(fullName).trim().length < 2) throw new BadRequestException({ error: 'Enter the full name on the document' });
    if (!Array.isArray(documents) || !documents.length) throw new BadRequestException({ error: 'Upload your document' });
    const docs: any[] = [];
    for (const d of documents) {
      if (!d || !/^[a-f0-9]{32}$/.test(d.docId || '')) throw new BadRequestException({ error: 'Bad document reference' });
      if (!fs.existsSync(this.kyc.docPath(d.docId))) throw new BadRequestException({ error: 'A document expired before submit — please re-upload' });
      docs.push({ id: d.docId, side: String(d.side || 'front').slice(0, 20), contentType: d.contentType || 'image/jpeg' });
    }
    const all = this.store.readJson<any[]>('kyc.json', []);
    const name = String(fullName).trim().slice(0, 120);
    const prior = all.filter((v) => (v.fullName || '').toLowerCase() === name.toLowerCase()).length;
    const dn = String(docNumber || '').replace(/\s+/g, '');
    const now = new Date().toISOString();
    const rec = {
      id: crypto.randomBytes(8).toString('hex'),
      ref: 'KYC-' + Date.now().toString(36).toUpperCase(),
      status: 'submitted',
      idType, country, fullName: name,
      docNumberMasked: dn ? dn.slice(0, 2) + '••••' + dn.slice(-2) : null,
      docNumberHash: dn ? crypto.createHash('sha256').update(dn).digest('hex') : null,
      documents: docs,
      attempt: prior + 1,
      submittedAt: now, reviewedAt: null, reviewedBy: null, rejection: null,
      vendor: null, vendorRiskScore: null, vendorDecision: null,
      ip: req.ip || '', ua: (req.headers['user-agent'] || '').slice(0, 200),
      events: [] as any[],
    };
    this.kyc.event(rec, 'user', 'submitted', idType + ' / ' + country);
    all.push(rec);
    this.store.writeJson('kyc.json', all);
    return { ok: true, ref: rec.ref, status: rec.status };
  }

  // User-facing status poll (by ref, no PII, no documents).
  @Get('kyc/status/:ref')
  status(@Param('ref') ref: string) {
    const v = this.store.readJson<any[]>('kyc.json', []).find((x) => x.ref === ref);
    if (!v) throw new NotFoundException({ error: 'Not found' });
    let reason: string | null = null;
    if (v.status === 'rejected' && v.rejection) {
      const r = KYC_REASONS.find((x) => x.code === v.rejection.code);
      reason = (r && r.user) || v.rejection.note || 'Please resubmit.';
    }
    return { ref: v.ref, status: v.status, idType: v.idType, submittedAt: v.submittedAt, reviewedAt: v.reviewedAt, reason };
  }

  @Get('kyc/reasons')
  reasons() {
    return KYC_REASONS.map((r) => ({ code: r.code, label: r.label }));
  }

  // Admin review queue (newest first).
  @UseGuards(SessionGuard)
  @Get('kyc')
  queue() {
    return this.store.readJson<any[]>('kyc.json', []).map((v) => this.kyc.public(v)).reverse();
  }

  // Gated document stream — authenticated admin only, never cached, view is logged.
  @UseGuards(SessionGuard)
  @Get('kyc/:id/documents/:docId')
  document(@Param('id') id: string, @Param('docId') docId: string, @Res() res: Response) {
    const all = this.store.readJson<any[]>('kyc.json', []);
    const v = all.find((x) => x.id === id);
    if (!v) return res.status(404).json({ error: 'Not found' });
    const doc = (v.documents || []).find((d: any) => d.id === docId);
    if (!doc) return res.status(404).json({ error: 'No such document' });
    const file = this.kyc.docPath(doc.id);
    if (!fs.existsSync(file)) return res.status(410).json({ error: 'Document purged' });
    let buf: Buffer;
    try { buf = this.kyc.decrypt(fs.readFileSync(file)); }
    catch { return res.status(500).json({ error: 'Could not decrypt document' }); }
    this.kyc.event(v, 'admin', 'viewed_document', doc.side);
    this.store.writeJson('kyc.json', all);
    res.setHeader('Content-Type', doc.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(buf);
  }

  // Approve — unlocks payouts (is_verified). Decision is audited.
  @UseGuards(SessionGuard)
  @Post('kyc/:id/approve')
  approve(@Param('id') id: string, @Req() req: Request) {
    const all = this.store.readJson<any[]>('kyc.json', []);
    const v = all.find((x) => x.id === id);
    if (!v) throw new NotFoundException({ error: 'Not found' });
    if (v.status !== 'approved') {
      v.status = 'approved'; v.reviewedAt = new Date().toISOString(); v.reviewedBy = 'admin'; v.rejection = null;
      this.kyc.event(v, 'admin', 'approved');
      this.store.writeJson('kyc.json', all);
      this.audit.record('kyc_approve', (v.fullName || v.ref) + ' · ' + v.idType + '/' + v.country, req.ip);
    }
    return this.kyc.public(v);
  }

  // Reject — requires a standardized reason; user is shown the mapped message.
  @UseGuards(SessionGuard)
  @Post('kyc/:id/reject')
  reject(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const { code, note } = body || {};
    if (!KYC_REASONS.find((r) => r.code === code)) throw new BadRequestException({ error: 'Pick a rejection reason' });
    const all = this.store.readJson<any[]>('kyc.json', []);
    const v = all.find((x) => x.id === id);
    if (!v) throw new NotFoundException({ error: 'Not found' });
    v.status = 'rejected'; v.reviewedAt = new Date().toISOString(); v.reviewedBy = 'admin';
    v.rejection = { code, note: String(note || '').slice(0, 300) };
    this.kyc.event(v, 'admin', 'rejected', code);
    this.store.writeJson('kyc.json', all);
    this.audit.record('kyc_reject', (v.fullName || v.ref) + ' · ' + code, req.ip);
    return this.kyc.public(v);
  }
}

@Module({ controllers: [KycController], providers: [KycService] })
export class KycModule {}
