import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgEventsController } from './org-events.controller';
import { OrgScopeService } from './org-scope.service';
import { EventProvisioningService } from './event-provisioning.service';
import { OrgSalesController } from './org-sales.controller';
import { OrgSalesService } from './org-sales.service';
import { OrgRegisterController } from './org-register.controller';

/* org module — the org-scoping spine. MT1 registers the shared services
   (OrgScopeService, EventProvisioningService) + GET /api/org/me. MT2 (events
   CRUD) and MT3 (sales/reporting) add their controllers HERE and inject the
   exported services, so app.module.ts churn is a single import line (MT1 only). */
/* BS41 (#4): OrgRegisterController is listed FIRST. Nest matches routes in
   controller-registration order, and its two paths are literals
   ('org/register', 'org/handle-available') that must never be shadowed by a
   parameterised route another org controller might add later. It is also the one
   controller here that is deliberately UNGUARDED — you cannot require an
   organizer session on the endpoint that creates one. */
@Module({
  controllers: [OrgRegisterController, OrgController, OrgEventsController, OrgSalesController],
  providers: [OrgScopeService, EventProvisioningService, OrgSalesService],
  exports: [OrgScopeService, EventProvisioningService],
})
export class OrgModule {}
