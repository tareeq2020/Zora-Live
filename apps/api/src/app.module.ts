import { Module } from '@nestjs/common';
import { StorageModule } from './storage/storage.module';
import { SessionModule } from './common/session.module';
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
import { AgentsModule } from './agents/agents.module';
import { TicketsModule } from './tickets/tickets.module';
import { EventsModule } from './events/events.module';
import { CheckoutModule } from './checkout/checkout.module';

/* Every feature module = one route group from the legacy server.js.
   StorageModule, AuditModule, TenantModule are @Global (injected everywhere). */
@Module({
  imports: [
    StorageModule,
    SessionModule,
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
    AgentsModule,
    TicketsModule,
    EventsModule,
    CheckoutModule,
  ],
})
export class AppModule {}
