import { Module } from '@nestjs/common';
import { OrgController } from './org.controller';
import { OrgScopeService } from './org-scope.service';
import { EventProvisioningService } from './event-provisioning.service';

/* org module — the org-scoping spine. MT1 registers the shared services
   (OrgScopeService, EventProvisioningService) + GET /api/org/me. MT2 (events
   CRUD) and MT3 (sales/reporting) add their controllers HERE and inject the
   exported services, so app.module.ts churn is a single import line (MT1 only). */
@Module({
  controllers: [OrgController],
  providers: [OrgScopeService, EventProvisioningService],
  exports: [OrgScopeService, EventProvisioningService],
})
export class OrgModule {}
