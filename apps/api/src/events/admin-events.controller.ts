import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { db, poolSnapshots } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { EntityStore } from '../storage/entity-store';
import { OrganizerRepo } from '../storage/organizer-repo';
import { AuditService } from '../audit/audit.module';

/* /api/admin/events (BS99 #1) — the SUPER-ADMIN events-manager, real this time.
   Replaces the mock `useMockEvents()` seam in the console with the actual events
   blob: EVERY event on the platform (including drafts + archived, which the public
   read hides), each enriched with its owner's display name and live sold/capacity
   from the inventory pool.

   super_admin-only (@Roles + SessionGuard; isAdmin maps to super_admin). Writes
   here are the admin side of the suspension story, at the event grain:
     · enable/disable  → archive / unarchive on the blob (archived = hidden from
       every public read, the same cascade the org-level suspension performs).
   The "mega" pin already has its own endpoint (PUT /api/events/:id/mega, the
   per-city single-mega invariant) — the console calls that directly. */
@Roles('super_admin')
@Controller('admin/events')
@UseGuards(SessionGuard)
export class AdminEventsController {
  constructor(
    private readonly entities: EntityStore,
    private readonly organizers: OrganizerRepo,
    private readonly audit: AuditService,
  ) {}

  /** GET /api/admin/events — every event, newest-first-ish (blob order), with
      owner name + live sold/capacity + status/enabled/mega. */
  @Get()
  async list() {
    const [rows, orgs, snaps] = await Promise.all([
      this.entities.read<any[]>('events', []),
      this.organizers.list(),
      poolSnapshots(db()),
    ]);
    const nameByHandle = new Map(orgs.map((o) => [o.handle, o.name]));
    const snapByTier = new Map(snaps.map((s) => [s.tierId, s]));

    return (rows || []).map((e) => {
      const tiers = e?.webCheckout?.tiers && Array.isArray(e.webCheckout.tiers) ? e.webCheckout.tiers : [];
      let sold = 0;
      let capacity = 0;
      for (const t of tiers) {
        const snap = t && t.tierId ? snapByTier.get(t.tierId) : null;
        if (snap) {
          sold += Number(snap.sold) || 0;
          capacity += Number(snap.capacity) || 0;
        }
      }
      const status = e?.status ?? 'published'; // null = legacy published
      return {
        id: e?.id,
        name: e?.name ?? 'Untitled event',
        owner: nameByHandle.get(e?.organizerHandle) ?? e?.organizerHandle ?? '—',
        ownerHandle: e?.organizerHandle ?? '',
        city: e?.city ?? '',
        status,
        enabled: status !== 'archived',
        mega: !!e?.mega,
        sold,
        capacity,
      };
    });
  }

  /** POST /api/admin/events/:id/enabled { enabled } — disable = archive (hidden
      from all public reads); enable = restore to published (draft if it has no
      sellable tier). Idempotent. */
  @Post(':id/enabled')
  async setEnabled(@Param('id') id: string, @Body() body: any, @Req() req: Request) {
    const enabled = body?.enabled === true;
    const rows = await this.entities.read<any[]>('events', []);
    const idx = rows.findIndex((e) => e && e.id === id);
    if (idx < 0) throw new NotFoundException({ error: 'event_not_found' });

    const ev = rows[idx];
    let nextStatus: string;
    if (!enabled) {
      nextStatus = 'archived';
    } else {
      const tiers = ev?.webCheckout?.tiers && Array.isArray(ev.webCheckout.tiers) ? ev.webCheckout.tiers : [];
      const hasLiveTier = tiers.some((t: any) => t && !t.disabled);
      nextStatus = hasLiveTier ? 'published' : 'draft';
    }
    const next = rows.map((e, i) => (i === idx ? { ...e, status: nextStatus, updated_at: new Date().toISOString() } : e));
    await this.entities.write('events', next);

    await this.audit.record(
      enabled ? 'admin.event.enable' : 'admin.event.disable',
      `${ev?.name ?? id} (${ev?.organizerHandle ?? '—'}) → ${nextStatus}`,
      req.ip,
    );
    return { ok: true, id, enabled, status: nextStatus };
  }
}
