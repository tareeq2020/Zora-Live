import { Controller, Get, Global, Injectable, Module, UseGuards } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';

/* Shared audit trail — organizers + KYC write to it. Port of server.js audit(). */
@Injectable()
export class AuditService {
  constructor(private readonly entities: EntityStore) {}

  async record(action: string, detail: string, ip?: string, actor?: string) {
    const log = await this.entities.read<any[]>('audit', []);
    // `actor` names the acting principal (MT2 org writes pass the organizer handle);
    // it defaults to 'admin' so every existing admin-side caller is byte-unchanged.
    log.push({ at: new Date().toISOString(), admin: actor || 'admin', action, detail: detail || '', ip: ip || '' });
    await this.entities.write('audit', log.slice(-500)); // keep last 500
  }
}

@UseGuards(SessionGuard)
@Controller()
export class AuditController {
  constructor(private readonly entities: EntityStore) {}

  @Get('audit')
  async get() {
    return (await this.entities.read<any[]>('audit', [])).slice(-120).reverse();
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
