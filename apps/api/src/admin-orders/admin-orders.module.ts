import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

/* admin-orders module (BS43 / plan #3) — the super-admin cart/order view.
   Read-only. Imports OrgModule for OrgScopeService (event names + organizer
   ownership live in the events blob, C3); OrganizerRepo comes from the @Global
   storage module. No schema change: orders, order_item and split_share already
   hold everything — 0014 only adds the indexes the new access pattern needs. */
@Module({
  imports: [OrgModule],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
  exports: [AdminOrdersService],
})
export class AdminOrdersModule {}
