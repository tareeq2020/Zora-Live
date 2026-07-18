import { BadRequestException, Body, Controller, Get, Module, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import { EntityStore } from '../storage/entity-store';
import { SessionService } from '../common/session.module';
import { SessionGuard } from '../common/session.guard';
import { DEFAULT_ORGANIZERS } from '../common/defaults';

const ADMIN_FALLBACK = { username: 'admin', passwordHash: '' };

@Controller()
export class AuthController {
  constructor(private readonly entities: EntityStore, private readonly sessions: SessionService) {}

  @Post('login')
  async login(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const { username, password } = body || {};
    const acct = await this.entities.read('admin', ADMIN_FALLBACK);
    // bcrypt hash ($2a$...) — verifier stays bcrypt-compatible.
    if (username === acct.username && bcrypt.compareSync(password || '', acct.passwordHash)) {
      // role:'admin' is additive — legacy consumers still read isAdmin.
      this.sessions.set(res, { isAdmin: true, role: 'admin' });
      return { ok: true };
    }
    throw new UnauthorizedException({ error: 'Wrong username or password' });
  }

  // PR-F-AUTH: real ORGANIZER login. Authenticates handle+password against the
  // 'organizers' collection (bcrypt passwordHash, mirroring the admin account) and
  // mints an organizer session. Suspended accounts and password-less records are
  // rejected. DEFER (comes with the app.zora.com move): CSRF token issuance and
  // the cross-subdomain impersonation handoff — the path-prefix phase is
  // same-origin with SameSite=Lax, an adequate baseline, and CSRF now would break
  // the curl-based e2e for no current benefit.
  @Post('org/login')
  async orgLogin(@Body() body: any, @Res({ passthrough: true }) res: Response) {
    const { handle, password } = body || {};
    const orgs = await this.entities.read<any[]>('organizers', DEFAULT_ORGANIZERS);
    const h = String(handle || '').toLowerCase();
    const org = orgs.find((o) => o.handle === h);
    if (
      org &&
      org.status !== 'suspended' &&
      org.passwordHash &&
      bcrypt.compareSync(password || '', org.passwordHash)
    ) {
      this.sessions.set(res, { organizerHandle: org.handle, role: 'organizer', kycStatus: org.kycStatus });
      return { ok: true };
    }
    throw new UnauthorizedException({ error: 'Wrong handle or password' });
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    this.sessions.clear(res);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request) {
    // Role-aware superset of the legacy { isAdmin } shape (purely additive).
    const s = req.session || {};
    return {
      isAdmin: !!s.isAdmin,
      role: s.role || (s.isAdmin ? 'admin' : null),
      organizerHandle: s.organizerHandle || null,
      impersonating: s.impersonating || null,
    };
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
