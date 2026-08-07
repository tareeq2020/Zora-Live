import { Module } from '@nestjs/common';
import { StorageModule } from './storage/storage.module';
import { SessionModule } from './common/session.module';
import { CommissionModule } from './common/commission.module';
import { AuditModule } from './audit/audit.module';
import { TenantModule } from './tenant/tenant.module';
import { AuthModule } from './auth/auth.module';
import { SettingsModule } from './settings/settings.module';
import { TiersModule } from './tiers/tiers.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { FloorplanModule } from './floorplan/floorplan.module';
import { MediaModule } from './media/media.module';
import { PlacementsModule } from './placements/placements.module';
import { OrganizersModule } from './organizers/organizers.module';
import { KycModule } from './kyc/kyc.module';
import { ThemeModule } from './theme/theme.module';
// BS42 (#1): AgentsModule became ScanModule — same /api/agents admin paths,
// now backed by `scanner_user` rows, plus the /api/scan/* door surface.
import { ScanModule } from './scan/scan.module';
import { TicketsModule } from './tickets/tickets.module';
import { EventsModule } from './events/events.module';
import { CheckoutModule } from './checkout/checkout.module';
import { PaymentsModule } from './payments/payments.module';
import { OrgModule } from './org/org.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ConsumerModule } from './consumer/consumer.module';
import { SplitsModule } from './splits/splits.module';

/* Every feature module = one route group from the legacy server.js.
   StorageModule, AuditModule, TenantModule are @Global (injected everywhere). */
@Module({
  imports: [
    StorageModule,
    SessionModule,
    CommissionModule,
    AuditModule,
    TenantModule,
    AuthModule,
    SettingsModule,
    TiersModule,
    RegistrationsModule,
    FloorplanModule,
    MediaModule,
    PlacementsModule,
    OrganizersModule,
    KycModule,
    ThemeModule,
    ScanModule,
    TicketsModule,
    EventsModule,
    CheckoutModule,
    PaymentsModule,
    OrgModule,
    PayoutsModule,
    ConsumerModule,
    SplitsModule,
  ],
})
export class AppModule {}
