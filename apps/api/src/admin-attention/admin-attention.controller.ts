import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { AdminAttentionService } from './admin-attention.service';

/* GET /api/admin/attention (BS152) — the overview's "Needs attention" queue.
   Read-only, super_admin only (same guard as /api/admin/orders). */
@Roles('super_admin')
@Controller('admin/attention')
@UseGuards(SessionGuard)
export class AdminAttentionController {
  constructor(private readonly attention: AdminAttentionService) {}

  @Get()
  async read() {
    return this.attention.read();
  }
}
