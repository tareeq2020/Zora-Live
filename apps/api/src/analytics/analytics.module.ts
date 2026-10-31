import { Body, Controller, HttpCode, Module, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { db, recordView } from '@zora/core';
import { resolveSessionSecret } from '../common/secret';
import { OrgModule } from '../org/org.module';
import { StorefrontAnalyticsController } from './storefront-analytics.controller';

/* BS123: storefront analytics beacon (Web Premium v1, F4 / A10).
   POST /api/v/track {kind, org, event?, anonId, referrer?, utm?} → always 204.
   Aggregates only; never blocks the page; rate-limited per IP in memory. */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
const hits = new Map<string, { at: number; n: number }>();

function allowed(ip: string, now = Date.now()): boolean {
  const h = hits.get(ip);
  if (!h || now - h.at > WINDOW_MS) {
    hits.set(ip, { at: now, n: 1 });
    if (hits.size > 50_000) hits.clear();
    return true;
  }
  h.n += 1;
  return h.n <= MAX_PER_WINDOW;
}

@Controller()
export class AnalyticsController {
  @Post('v/track')
  @HttpCode(204)
  async track(@Body() body: any, @Req() req: Request): Promise<void> {
    try {
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      if (!allowed(ip)) return;
      if (!body || typeof body !== 'object') return;
      await recordView(db(), {
        kind: body.kind,
        org: String(body.org ?? ''),
        event: body.event ? String(body.event) : null,
        anonId: String(body.anonId ?? ''),
        referrer: typeof body.referrer === 'string' ? body.referrer.slice(0, 500) : null,
        utmSource: typeof body.utm === 'string' ? body.utm.slice(0, 100) : null,
        userAgent: String(req.headers['user-agent'] || ''),
        secret: resolveSessionSecret(),
      });
    } catch (e) {
      console.error('analytics beacon failed', (e as Error)?.message);
    }
  }
}

@Module({ imports: [OrgModule], controllers: [AnalyticsController, StorefrontAnalyticsController] })
export class AnalyticsModule {}
