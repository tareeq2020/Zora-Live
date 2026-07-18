import { BadRequestException, Body, Controller, Delete, Get, Module, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';

const THREE_DAYS = 1000 * 60 * 60 * 24 * 3;
const genCode = () => String(Math.floor(100000 + Math.random() * 900000)); // 6-digit check-in code

@UseGuards(SessionGuard)
@Controller()
export class AgentsController {
  constructor(private readonly entities: EntityStore) {}

  @Get('agents')
  list() {
    return this.entities.read('agents', []);
  }

  @Post('agents')
  async create(@Body() body: any) {
    const { name, contact, event } = body || {};
    if (!name || !contact) throw new BadRequestException({ error: 'Agent name and phone or email are required' });
    const agents = await this.entities.read<any[]>('agents', []);
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
    await this.entities.write('agents', agents);
    return agent;
  }

  @Post('agents/:id/rotate')
  async rotate(@Param('id') id: string) {
    const agents = await this.entities.read<any[]>('agents', []);
    const a = agents.find((x) => x.id === id);
    if (!a) throw new NotFoundException({ error: 'Not found' });
    a.code = genCode();
    a.expiresAt = new Date(Date.now() + THREE_DAYS).toISOString();
    await this.entities.write('agents', agents);
    return a;
  }

  @Delete('agents/:id')
  async remove(@Param('id') id: string) {
    const agents = await this.entities.read<any[]>('agents', []);
    await this.entities.write('agents', agents.filter((x) => x.id !== id));
    return { ok: true };
  }
}

@Module({ controllers: [AgentsController] })
export class AgentsModule {}
