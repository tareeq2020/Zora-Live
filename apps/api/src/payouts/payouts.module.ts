import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { OrgPayoutsController } from './org-payouts.controller';
import { AdminPayoutsController } from './admin-payouts.controller';
import { PayoutsService } from './payouts.service';

/* payouts module (BS38 / #7) — both sides of the withdrawal ledger:
   /api/org/payouts (organizer, OrganizerGuard) and /api/admin/payouts (staff,
   SessionGuard). It imports OrgModule for OrgScopeService (event ownership lives
   in the events blob, C3); OrganizerRepo and AuditService come from the @Global
   storage/audit modules. */
@Module({
  imports: [OrgModule],
  controllers: [OrgPayoutsController, AdminPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
