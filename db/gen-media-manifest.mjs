#!/usr/bin/env node
/* Generate data/media_manifest.json — intrinsic metadata for the committed
   static site assets, so the media manager lists them without reading disk at
   runtime. Uploads append their own rows at upload time (see MediaService).
   Re-run this after committing new static assets under apps/web/public/assets.
   Byte-for-byte reproduces the fields the old fs-walk produced (dims/sizeKB),
   frozen in the committed JSON so ordering no longer depends on disk mtimes.
   Usage: node db/gen-media-manifest.mjs [assetsDir] */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { config } from 'dotenv';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_DIR = join(HERE, '..', 'apps', 'api');
config({ path: join(API_DIR, '.env') });

const raw = process.argv[2] || process.env.ZORA_ASSETS_DIR || join(API_DIR, 'public', 'assets');
const assetsDir = isAbsolute(raw) ? raw : resolve(API_DIR, raw);

// Same header-parse as MediaService.imageSize, but over a Buffer.
function imageSize(b) {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; // PNG
  if (b[0] === 0xff && b[1] === 0xd8) { // JPEG — scan SOF markers
    let o = 2;
    while (o < b.length - 8) {
      if (b[o] !== 0xff) { o++; continue; }
      const m = b[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7) };
      o += 2 + b.readUInt16BE(o + 2);
    }
  }
  return null;
}

const files = readdirSync(assetsDir).filter((f) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f));
const rows = files
  .map((f) => {
    const fp = join(assetsDir, f);
    const st = statSync(fp);
    const d = imageSize(readFileSync(fp));
    return { name: f, url: '/assets/' + f, sizeKB: Math.round(st.size / 1024), w: d ? d.w : null, h: d ? d.h : null, modified: st.mtimeMs };
  })
  .sort((a, b) => b.modified - a.modified);

const out = join(HERE, '..', 'data', 'media_manifest.json');
writeFileSync(out, JSON.stringify(rows, null, 2) + '\n');
console.log(`wrote ${out} (${rows.length} rows)`);
