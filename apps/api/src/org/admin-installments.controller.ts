import { Body, Controller, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { db, pendingInstallmentRefunds, recordInstallmentRefund } from '@zora/core';
import { SessionGuard } from '../common/session.guard';
import { Roles } from '../common/roles.guard';
import { AuditService } from '../audit/audit.module';

/* BS136 (F7, owner decision 3): the admin installment-refund worklist.

   A defaulted plan owes the buyer what they paid minus the service fee
   (installment_plan.refund_due, refund_status 'pending'). x-bridge has no
   reversal Zora can call, so ops pays the buyer back by hand and then records it:

   GET  /api/admin/installments/refunds                 → { refunds: PendingInstallmentRefund[] }
   POST /api/admin/installments/:orderId/refund-recorded { reference } → recordInstallmentRefund

   super_admin only (SessionGuard + @Roles), every record audited. */
@Roles('super_admin')
@UseGuards(SessionGuard)
@Controller('admin/installments')
export class AdminInstallmentsController {
  constructor(private readonly audit: AuditService) {}

  @Get('refunds')
  async refunds() {
    return { refunds: await pendingInstallmentRefunds(db()) };
  }

  @Post(':orderId/refund-recorded')
  async recorded(@Param('orderId') orderId: string, @Body() body: any, @Req() req: Request, @Res() res: Response) {
    if (!/^[0-9a-f-]{36}$/i.test(String(orderId))) return res.status(404).json({ error: 'not_found' });
    const reference = typeof body?.reference === 'string' ? body.reference.trim() : '';
    if (!reference || reference.length > 120) return res.status(400).json({ error: 'reference_required' });
    const r = await recordInstallmentRefund(db(), orderId, reference);
    if (!r.ok) return res.status(r.reason === 'not_found' ? 404 : 409).json({ error: r.reason });
    await this.audit.record('installment_refund_recorded', `order ${orderId} · ${r.refunded} · ref ${reference}`, req.ip);
    return res.status(200).json(r);
  }
}
