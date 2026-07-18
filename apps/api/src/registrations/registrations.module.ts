import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';

/* Crew registrations live in the 'registrations' Postgres collection. */
@Controller()
export class RegistrationsController {
  constructor(private readonly entities: EntityStore) {}

  // Public write.
  @Post('register')
  async register(@Body() body: any) {
    const { crewName, leadName, phone, email, size } = body || {};
    if (!crewName || !leadName || !phone) {
      throw new BadRequestException({ error: 'Crew name, lead name and phone are required' });
    }
    const crewSize = parseInt(size, 10);
    if (!crewSize || crewSize < 2 || crewSize > 6) {
      throw new BadRequestException({ error: 'Crew size must be between 2 and 6' });
    }
    const regs = await this.entities.read<any[]>('registrations', []);
    const cleanPhone = String(phone).replace(/[^\d+]/g, '');
    if (regs.some((r) => r.phone === cleanPhone)) {
      throw new ConflictException({ error: 'This phone number is already on the manifest' });
    }
    const code = 'Z001-' + String(regs.length + 1).padStart(4, '0');
    const reg = {
      id: Date.now().toString(36),
      code,
      crewName: String(crewName).slice(0, 80),
      leadName: String(leadName).slice(0, 80),
      phone: cleanPhone,
      email: String(email || '').slice(0, 120),
      size: crewSize,
      at: new Date().toISOString(),
    };
    regs.push(reg);
    await this.entities.write('registrations', regs);
    return { ok: true, code };
  }

  @UseGuards(SessionGuard)
  @Get('registrations')
  async list() {
    return this.entities.read('registrations', []);
  }

  @UseGuards(SessionGuard)
  @Delete('registrations/:id')
  async remove(@Param('id') id: string) {
    const regs = await this.entities.read<any[]>('registrations', []);
    await this.entities.write('registrations', regs.filter((x) => x.id !== id));
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Get('registrations.csv')
  async csv(@Res() res: Response) {
    const regs = await this.entities.read<any[]>('registrations', []);
    const esc = (v: any) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = [['code', 'crew', 'lead', 'phone', 'email', 'size', 'registered_at']]
      .concat(regs.map((r) => [r.code, r.crewName, r.leadName, r.phone, r.email, r.size, r.at]));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="zora-drop-001-manifest.csv"');
    res.send('﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n'));
  }
}

@Module({ controllers: [RegistrationsController] })
export class RegistrationsModule {}
