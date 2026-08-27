import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { ScanController } from './scan.controller';
import { ScannerAdminController } from './scanner-admin.controller';
import { OrgScannersController } from './org-scanners.controller';
import { ScanGuard } from './scan.guard';

/* BS42 (#1) — the door.
   Replaces AgentsModule: the scanner-user CRUD moved here (same /api/agents
   paths, now backed by the `scanner_user` table) so the admin surface and the
   scanner surface share one repo and one notion of role + scope.
   ScannerUserRepo comes from the @Global StorageModule. */
@Module({
  imports: [OrgModule], // BS106: OrgScopeService for org-provisioned scanners
  controllers: [ScanController, ScannerAdminController, OrgScannersController],
  providers: [ScanGuard],
})
export class ScanModule {}
