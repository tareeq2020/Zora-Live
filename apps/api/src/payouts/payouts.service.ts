import { Injectable } from '@nestjs/common';
import {
  db, resolveCommissionRate, availableBalances, requestPayout, decidePayout, listPayouts, getPayout,
  payoutDestinationCatalog,
} from '@zora/core';
import type {
  PayoutBalance, PayoutRecord, RequestPayoutResult, DecidePayoutResult, PayoutOrgContext,
} from '@zora/core';
import { OrgScopeService } from '../org/org-scope.service';
import { OrganizerRepo } from '../storage/organizer-repo';

/* PayoutsService (BS38 / #7) — the API-side seam. All the money math (balance,
   the per-org lock, the reservation, the typed rejections) lives in @zora/core;
   this class only resolves WHO is asking:

     · which events the org owns  → OrgScopeService (the events blob, C3)
     · the org's live rate        → OrganizerRepo, for orders with no stamp
     · is the org verified        → organizer.kycStatus === 'approved' (#5 gate)

   Nothing here recomputes a balance or a commission. If a number is wrong it is
   wrong in core, in one place, for every surface at once. */

/** #5 — verification is what unlocks withdrawals (plan #7 decision (d)). */
export const VERIFIED_KYC_STATUS = 'approved';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly scope: OrgScopeService,
    private readonly organizers: OrganizerRepo,
  ) {}

  /** The org context core needs: owned events + the fallback commission rate. */
  private async contextFor(handle: string): Promise<{ ctx: PayoutOrgContext; verified: boolean }> {
    const [org, ownedEventIds] = await Promise.all([
      this.organizers.byHandle(handle),
      this.scope.ownedEventIds(handle),
    ]);
    return {
      ctx: { handle, ownedEventIds, fallbackRate: resolveCommissionRate(null, org) },
      verified: (org?.kycStatus ?? null) === VERIFIED_KYC_STATUS,
    };
  }

  /** GET /api/org/payouts — history + the live per-currency balance. */
  async organizerView(handle: string): Promise<{
    balances: PayoutBalance[];
    payouts: PayoutRecord[];
    verified: boolean;
    commissionRate: number;
    pendingCount: number;
  }> {
    const { ctx, verified } = await this.contextFor(handle);
    const sql = db();
    const [balances, payouts] = await Promise.all([
      availableBalances(sql, ctx),
      // ALWAYS scoped to the acting handle — cross-org isolation is structural
      // here, not a filter the UI is trusted to apply.
      listPayouts(sql, { handle, limit: 100 }),
    ]);
    return {
      balances,
      payouts,
      verified,
      commissionRate: ctx.fallbackRate,
      pendingCount: payouts.filter((p) => p.status === 'requested').length,
    };
  }

  /** The lists the withdrawal form renders (methods · banks · MNOs). Static —
      comes straight from the canonical registry, no DB. */
  destinationCatalog() {
    return payoutDestinationCatalog();
  }

  /** POST /api/org/payouts — the money-critical path (core holds the lock). */
  async request(
    handle: string,
    amount: number,
    currency: string,
    note?: string | null,
    destination?: unknown,
  ): Promise<RequestPayoutResult> {
    const { ctx, verified } = await this.contextFor(handle);
    return requestPayout(db(), { org: ctx, amount, currency, kycApproved: verified, note, destination });
  }

  /** GET /api/admin/payouts — the whole queue (optionally one status). */
  async adminList(status?: string | null, limit?: number): Promise<PayoutRecord[]> {
    const s = status === 'requested' || status === 'approved' || status === 'rejected' ? status : null;
    return listPayouts(db(), { status: s, limit: limit ?? 200 });
  }

  async byId(id: string): Promise<PayoutRecord | null> {
    return getPayout(db(), id);
  }

  /** PUT /api/admin/payouts/:id — approve with a reference / reject with a reason. */
  async decide(
    id: string,
    decision: 'approve' | 'reject',
    decidedBy: string,
    body: { reference?: string | null; fxNote?: string | null; reason?: string | null },
  ): Promise<DecidePayoutResult> {
    return decidePayout(db(), {
      id, decision, decidedBy,
      reference: body.reference, fxNote: body.fxNote, reason: body.reason,
    });
  }
}
