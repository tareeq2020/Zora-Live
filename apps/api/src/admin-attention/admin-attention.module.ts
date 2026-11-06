import { Module } from '@nestjs/common';
import { OrgModule } from '../org/org.module';
import { AdminAttentionController } from './admin-attention.controller';
import { AdminAttentionService } from './admin-attention.service';

/* BS152 — admin attention queue. OrgModule gives OrgScopeService (event names +
   owners from the events blob); OrganizerRepo and EntityStore are @Global. */
@Module({
  imports: [OrgModule],
  controllers: [AdminAttentionController],
  providers: [AdminAttentionService],
})
export class AdminAttentionModule {}
