import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { FileStore } from '../storage/file-store.service';
import { SessionGuard } from '../common/session.guard';

const THREE_DAYS = 1000 * 60 * 60 * 24 * 3;
const genCode = () => String(Math.floor(100000 + Math.random() * 900000)); // 6-digit check-in code

@UseGuards(SessionGuard)
@Controller()
export class AgentsController {
  constructor(private readonly store: FileStore) {}

  @Get('agents')
  list() {
    return this.store.readJson('agents.json', []);
  }

  @Post('agents')
  create(@Body() body: any) {
    const { name, contact, event } = body || {};
    if (!name || !contact) throw new BadRequestException({ error: 'Agent name and phone or email are required' });
    const agents = this.store.readJson<any[]>('agents.json', []);
    const agent = {
      id: Date.now().toString(36),
      name: String(name).slice(0, 80),
      contact: String(contact).slice(0, 120),
      via: /@/.test(contact) ? 'email' : 'phone',
      event: String(event || 'All events').slice(0, 80),
      role: 'agent',
      code: genCode(),
      status: 'active',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + THREE_DAYS).toISOString(),
    };
    agents.push(agent);
    this.store.writeJson('agents.json', agents);
    return agent;
  }

  @Post('agents/:id/rotate')
  rotate(@Param('id') id: string) {
    const agents = this.store.readJson<any[]>('agents.json', []);
    const a = agents.find((x) => x.id === id);
    if (!a) throw new NotFoundException({ error: 'Not found' });
    a.code = genCode();
    a.expiresAt = new Date(Date.now() + THREE_DAYS).toISOString();
    this.store.writeJson('agents.json', agents);
    return a;
  }

  @Delete('agents/:id')
  remove(@Param('id') id: string) {
    this.store.writeJson('agents.json', this.store.readJson<any[]>('agents.json', []).filter((x) => x.id !== id));
    return { ok: true };
  }
}

@Module({ controllers: [AgentsController] })
export class AgentsModule {}
