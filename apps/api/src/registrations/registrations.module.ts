import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Module, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';

@Controller()
export class RegistrationsController {
  constructor(private readonly store: FileStore) {}

  // Public write.
  @Post('register')
  register(@Body() body: any) {
    const { crewName, leadName, phone, email, size } = body || {};
    if (!crewName || !leadName || !phone) {
      throw new BadRequestException({ error: 'Crew name, lead name and phone are required' });
    }
    const crewSize = parseInt(size, 10);
    if (!crewSize || crewSize < 2 || crewSize > 6) {
      throw new BadRequestException({ error: 'Crew size must be between 2 and 6' });
    }
    const regs = this.store.readJson<any[]>('registrations.json', []);
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
    this.store.writeJson('registrations.json', regs);
    return { ok: true, code };
  }

  @UseGuards(SessionGuard)
  @Get('registrations')
  list() {
    return this.store.readJson('registrations.json', []);
  }

  @UseGuards(SessionGuard)
  @Delete('registrations/:id')
  remove(@Param('id') id: string) {
    this.store.writeJson('registrations.json', this.store.readJson<any[]>('registrations.json', []).filter((x) => x.id !== id));
    return { ok: true };
  }

  @UseGuards(SessionGuard)
  @Get('registrations.csv')
  csv(@Res() res: Response) {
    const regs = this.store.readJson<any[]>('registrations.json', []);
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
