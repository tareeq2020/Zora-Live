import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { BroadcastsService } from './broadcasts.service';
import { OrgBroadcastsController } from './org-broadcasts.controller';
import { AdminBroadcastsController } from './admin-broadcasts.controller';
import { UnsubscribeController } from './unsubscribe.controller';

/* broadcasts module (BS43 / #2) — three surfaces over ONE service:
     /api/org/broadcasts     organizer, scoped to their own events (OrganizerGuard)
     /api/admin/broadcasts   staff, any scope (SessionGuard)
     /api/unsubscribe/:token public, no guard — the token IS the authorization

   It imports OrgModule for OrgScopeService (event ownership lives in the events
   blob, C3); OrganizerRepo and AuditService come from the @Global storage/audit
   modules. Nothing here sends: every send is queued and the worker drains it in
   bounded batches (ARCH-4). */
@Module({
  imports: [OrgModule],
  controllers: [OrgBroadcastsController, AdminBroadcastsController, UnsubscribeController],
  providers: [BroadcastsService],
  exports: [BroadcastsService],
})
export class BroadcastsModule {}
