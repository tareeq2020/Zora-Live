import 'reflect-metadata';
import './common/session'; // session type augmentation
try { require('dotenv').config(); } catch { /* dotenv optional */ }

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { verifySession, readSessionCookie } from './common/session-cookie';
import { AppModule } from './app.module';
import { ExpressStatusInterceptor } from './common/express-status.interceptor';
import { resolveSessionSecret } from './common/secret';

async function bootstrap() {
  const SESSION_SECRET = resolveSessionSecret();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Every backend route lives under /api (front-end owns /admin, /events/:id,
  // /@handle, static). Global prefix keeps controller paths clean.
  app.setGlobalPrefix('api');

  // Match Express: POST handlers return 200, not Nest's default 201.
  app.useGlobalInterceptors(new ExpressStatusInterceptor());

  // Body parser: 12mb to fit base64 image uploads (matches server.js).
  app.use(express.json({ limit: '12mb' }));

  // Stateless signed-cookie session (no server store): populate req.session from
  // the verified cookie. Controllers set it via SessionService.
  app.use((req: any, _res: any, next: any) => {
    req.session = verifySession(readSessionCookie(req), SESSION_SECRET) || {};
    next();
  });

  const PORT = process.env.PORT || 4101;
  await app.listen(PORT);
  console.log(`ZORA api (NestJS) -> http://localhost:${PORT}`);
}
bootstrap();
