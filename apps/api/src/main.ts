import 'reflect-metadata';
import './common/session'; // session type augmentation
import * as path from 'path';
import * as fs from 'fs';
try { require('dotenv').config(); } catch { /* dotenv optional */ }

// Resolve the shared data dir to an absolute path BEFORE anything reads it, so
// FileStore and the vendored events.js (both read ZORA_DATA_DIR) agree exactly.
const RAW_DATA_DIR = process.env.ZORA_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const DATA_DIR = path.isAbsolute(RAW_DATA_DIR) ? RAW_DATA_DIR : path.resolve(process.cwd(), RAW_DATA_DIR);
process.env.ZORA_DATA_DIR = DATA_DIR;

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import express from 'express';
import { AppModule } from './app.module';
import { seed } from './bootstrap/seed';
import { ExpressStatusInterceptor } from './common/express-status.interceptor';

async function bootstrap() {
  seed(DATA_DIR);
  const SESSION_SECRET = fs.readFileSync(path.join(DATA_DIR, '.session-secret'), 'utf8');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Every backend route lives under /api (front-end owns /admin, /events/:id,
  // /@handle, static). Global prefix keeps controller paths clean.
  app.setGlobalPrefix('api');

  // Match Express: POST handlers return 200, not Nest's default 201.
  app.useGlobalInterceptors(new ExpressStatusInterceptor());

  // Body parser: 12mb to fit base64 image uploads (matches server.js).
  app.use(express.json({ limit: '12mb' }));

  // Session: identical cookie config to the legacy server (httpOnly, lax, 8h).
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
    }),
  );

  const PORT = process.env.PORT || 4101;
  await app.listen(PORT);
  console.log(`ZORA api (NestJS) -> http://localhost:${PORT}   (data: ${DATA_DIR})`);
}
bootstrap();
