import { Controller, Get, Global, Injectable, Module, UseGuards } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';

/* Shared audit trail — organizers + KYC write to it. Port of server.js audit(). */
@Injectable()
export class AuditService {
  constructor(private readonly store: FileStore) {}

  record(action: string, detail: string, ip?: string) {
    const log = this.store.readJson<any[]>('audit.json', []);
    log.push({ at: new Date().toISOString(), admin: 'admin', action, detail: detail || '', ip: ip || '' });
    this.store.writeJson('audit.json', log.slice(-500)); // keep last 500
  }
}

@UseGuards(SessionGuard)
@Controller()
export class AuditController {
  constructor(private readonly store: FileStore) {}

  @Get('audit')
  get() {
    return this.store.readJson<any[]>('audit.json', []).slice(-120).reverse();
  }
}

@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
