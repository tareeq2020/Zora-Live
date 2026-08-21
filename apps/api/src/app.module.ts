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
import { BroadcastsModule } from './broadcasts/broadcasts.module';
import { AdminOrdersModule } from './admin-orders/admin-orders.module';
import { TicketsModule } from './tickets/tickets.module';
import { ShareCardModule } from './share-card/share-card.module';
import { EventsModule } from './events/events.module';
import { CheckoutModule } from './checkout/checkout.module';
import { PaymentsModule } from './payments/payments.module';
import { OrgModule } from './org/org.module';
import { PayoutsModule } from './payouts/payouts.module';
import { ConsumerModule } from './consumer/consumer.module';
import { SplitsModule } from './splits/splits.module';
import { APP_GUARD } from '@nestjs/core';
import { RolesGuard } from './common/roles.guard';

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
    BroadcastsModule,
    AdminOrdersModule,
    TicketsModule,
    ShareCardModule,
    EventsModule,
    CheckoutModule,
    PaymentsModule,
    OrgModule,
    PayoutsModule,
    ConsumerModule,
    SplitsModule,
  ],
  /* BS93 (Phase 2, E4): the RBAC guard is GLOBAL but a no-op unless a route carries
     @Roles(...) — so it cooperates with (never replaces) OrganizerGuard/SessionGuard. */
  providers: [{ provide: APP_GUARD, useClass: RolesGuard }],
})
export class AppModule {}
