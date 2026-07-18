import { BadRequestException, Body, Controller, Get, Module, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { EntityStore } from '../storage/entity-store';
import { SessionGuard } from '../common/session.guard';

const ADMIN_FALLBACK = { username: 'admin', passwordHash: '' };

@Controller()
export class AuthController {
  constructor(private readonly entities: EntityStore) {}

  @Post('login')
  async login(@Body() body: any, @Req() req: Request) {
    const { username, password } = body || {};
    const acct = await this.entities.read('admin', ADMIN_FALLBACK);
    // bcrypt hash ($2a$...) — verifier stays bcrypt-compatible.
    if (username === acct.username && bcrypt.compareSync(password || '', acct.passwordHash)) {
      req.session.isAdmin = true;
      return { ok: true };
    }
    throw new UnauthorizedException({ error: 'Wrong username or password' });
  }

  @Post('logout')
  logout(@Req() req: Request, @Res() res: Response) {
    req.session.destroy(() => res.json({ ok: true }));
  }

  @Get('me')
  me(@Req() req: Request) {
    return { isAdmin: !!(req.session && req.session.isAdmin) };
  }

  @UseGuards(SessionGuard)
  @Post('password')
  async password(@Body() body: any) {
    const { current, next } = body || {};
    const acct = await this.entities.read('admin', ADMIN_FALLBACK);
    if (!bcrypt.compareSync(current || '', acct.passwordHash)) {
      throw new BadRequestException({ error: 'Current password is wrong' });
    }
    if (!next || next.length < 8) {
      throw new BadRequestException({ error: 'New password must be at least 8 characters' });
    }
    acct.passwordHash = bcrypt.hashSync(next, 10);
    await this.entities.write('admin', acct);
    return { ok: true };
  }
}

@Module({ controllers: [AuthController] })
export class AuthModule {}
