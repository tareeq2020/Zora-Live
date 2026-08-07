import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { OrganizerRepo, verificationOrganizer } from '../storage/organizer-repo';
import { SessionGuard } from '../common/session.guard';
import { AuditService } from '../audit/audit.module';
import { KYC_REASONS } from '../common/defaults';

/* BS41 (#5) — SELF-SIGNUP ORGANIZER VERIFICATION.

   This lives in the KYC module, and its routes hang off /api/kyc, because #5 is
   not a new concept: the plan locked "verification = the EXISTING KYC approval
   gate, extended to cover self-registered orgs. One review queue." A second,
   parallel notion of "approved" would immediately raise the question the gates
   can't answer — is an org that passed verification but not KYC allowed to sell?
   There is one answer because there is one field: kyc_status === 'approved' is
   what assertKycApproved (I6) and the payout `not_verified` refusal both read.

   What it adds on top of /api/kyc is the SUBJECT. The existing endpoints review
   an identity DOCUMENT submission (collection 'kyc'), which a self-signup does
   not have — nobody uploaded a passport, they proved a phone. So the queue below
   reviews the ORGANIZER ROW instead, and reuses everything else verbatim: the
   admin SessionGuard, the KYC_REASONS rejection vocabulary (and therefore the
   copy the organizer reads), and the audit trail.

     GET  /api/kyc/organizers                  the self-signup queue
     POST /api/kyc/organizers/:id/approve      → status 'active', kyc 'approved'
     POST /api/kyc/organizers/:id/reject       { code, note? } → kyc 'rejected'
*/
@UseGuards(SessionGuard)
@Controller('kyc/organizers')
export class OrgVerificationController {
  constructor(
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
  ) {}

  /** The queue — every self-registered org, oldest first. Decided ones stay in
      the list (with their outcome) so a reviewer can see what they just did and
      undo a mistake by approving a rejected org; the console splits waiting from
      decided on `kycStatus`. */
  @Get()
  async queue() {
    const orgs = await this.organizers.listSelfSignups();
    return orgs.map(verificationOrganizer);
  }

  /** Approve — this is the moment a self-signup becomes a real seller: it
      unlocks publishing a sellable drop AND requesting a payout, because both
      gates read kyc_status. Idempotent: approving an approved org is a no-op
      that still returns the record. */
  @Post(':id/approve')
  async approve(@Param('id') id: string, @Req() req: Request) {
    const org = await this.organizers.byId(id);
    if (!org) throw new NotFoundException({ error: 'Not found' });
    if (org.source !== 'self-signup') {
      // Staff-created orgs are managed from the ORGANIZERS section (status) and
      // the identity queue (kyc). Refuse rather than quietly widening this
      // endpoint into a second way to flip an arbitrary org to approved.
      throw new BadRequestException({ error: 'not_a_self_signup', message: 'This organizer did not self-register.' });
    }
    const updated = await this.organizers.recordVerification(id, 'approve', 'admin');
    if (!updated) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('org_verify_approve', `${updated.name} (${updated.handle}) → active/approved`, req.ip);
    return verificationOrganizer(updated);
  }

  /** Reject — a reason is REQUIRED, from the same standardized list the identity
      queue uses, so the organizer gets the existing KYC reject copy rather than
      silence. Rejection is "not yet", not a ban: status stays 'pending', drafts
      survive, and a later approve needs no second signup. */
  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const code = String(body?.code ?? '');
    if (!KYC_REASONS.find((r) => r.code === code)) {
      throw new BadRequestException({ error: 'reason_required', message: 'Pick a rejection reason.' });
    }
    const org = await this.organizers.byId(id);
    if (!org) throw new NotFoundException({ error: 'Not found' });
    if (org.source !== 'self-signup') {
      throw new BadRequestException({ error: 'not_a_self_signup', message: 'This organizer did not self-register.' });
    }
    const note = String(body?.note ?? '').trim().slice(0, 300);
    const reason = note ? `${code} · ${note}` : code;
    const updated = await this.organizers.recordVerification(id, 'reject', 'admin', reason);
    if (!updated) throw new NotFoundException({ error: 'Not found' });
    await this.audit.record('org_verify_reject', `${updated.name} (${updated.handle}) · ${code}`, req.ip);
    return verificationOrganizer(updated);
  }
}
