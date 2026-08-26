import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { AuditModule } from '../audit/audit.module';
import { OrgCompsController } from './org-comps.controller';

/* comps module (BS104) — organizer complimentary passes. Imports OrgModule for
   OrgScopeService (event ownership lives in the events blob) and AuditModule for
   the audit trail; OrganizerGuard + the @Global storage come from elsewhere. */
@Module({
  imports: [OrgModule, AuditModule],
  controllers: [OrgCompsController],
})
export class CompsModule {}
