import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { db } from '@zora/core';

/* BS142: liveness + DB readiness for the Render health check (and uptime
   monitors). GET /api/health → 200 {ok:true,db:true} | 503 {ok:false,db:false}.
   No secrets, no version strings beyond the deployed commit (Render sets
   RENDER_GIT_COMMIT). */
@Controller()
export class HealthController {
  @Get('health')
  async health(@Res() res: Response) {
    const commit = (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null;
    try {
      await db()`select 1`;
      return res.status(200).json({ ok: true, db: true, commit });
    } catch {
      return res.status(503).json({ ok: false, db: false, commit });
    }
  }
}

@Module({ controllers: [HealthController] })
export class HealthModule {}
