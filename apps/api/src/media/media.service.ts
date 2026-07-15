import { BadRequestException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { FileStore } from '../storage/file-store.service';

/* Central media management + CDN sorting — direct port of server.js listMedia /
   imageSize / categorize / upload. ASSETS_DIR is resolved from ZORA_ASSETS_DIR so
   listings match the legacy oracle during migration. */
@Injectable()
export class MediaService {
  readonly assetsDir: string;

  constructor(private readonly store: FileStore) {
    const raw = process.env.ZORA_ASSETS_DIR || path.join(__dirname, '..', '..', 'public', 'assets');
    this.assetsDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }

  // Read intrinsic dimensions straight from the file header (PNG + JPEG SOF scan).
  private imageSize(fp: string): { w: number; h: number } | null {
    try {
      const b = fs.readFileSync(fp);
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
    } catch {}
    return null;
  }

  private categorize(f: string): string {
    if (/hero|banner/i.test(f)) return 'banner';
    if (/event-|tile/i.test(f)) return 'marketplace tile';
    if (/map|floor|venue/i.test(f)) return 'organizer map';
    return 'asset';
  }

  listMedia() {
    const statuses = this.store.readJson<Record<string, any>>('media.json', {});
    let files: string[] = [];
    try { files = fs.readdirSync(this.assetsDir).filter((f) => /\.(jpe?g|png|gif|webp|avif|svg)$/i.test(f)); } catch {}
    return files
      .map((f) => {
        const st = fs.statSync(path.join(this.assetsDir, f));
        const kb = Math.round(st.size / 1024);
        const d = this.imageSize(path.join(this.assetsDir, f));
        const lowres = d ? d.w < 1000 || d.h < 600 : kb < 40;
        const meta = statuses[f] || {};
        return {
          name: f,
          url: '/assets/' + f,
          cdnUrl: 'cdn.zora.com/img/' + crypto.createHash('md5').update(f).digest('hex').slice(0, 8) + '/' + f + '?w=1600&q=80&fm=webp',
          sizeKB: kb,
          optimizedKB: Math.max(6, Math.round(kb * 0.42)),
          dims: d ? d.w + '×' + d.h : '—',
          lowres,
          category: this.categorize(f),
          status: meta.status || (lowres ? 'flagged' : 'pending'),
          flagReason: meta.flagReason || (lowres ? 'Low resolution — below 1000px wide' : ''),
          modified: st.mtimeMs,
        };
      })
      .sort((a, b) => b.modified - a.modified);
  }

  upload(name: string, dataUrl: string) {
    const m = /^data:image\/(jpe?g|png|webp|gif);base64,/.exec(dataUrl || '');
    if (!m) throw new BadRequestException({ error: 'Send a JPG, PNG, WEBP or GIF image' });
    const ext = m[1].replace('jpeg', 'jpg');
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new BadRequestException({ error: 'Image is over 8MB' });
    const safe =
      String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    const fname = Date.now().toString(36) + '-' + safe + '.' + ext;
    fs.mkdirSync(this.assetsDir, { recursive: true });
    fs.writeFileSync(path.join(this.assetsDir, fname), buf);
    return { ok: true, name: fname, url: '/assets/' + fname };
  }
}
