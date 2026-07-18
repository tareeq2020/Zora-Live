import { Injectable, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { EntityStore } from '../storage/entity-store';
import { SupabaseStorage } from '../storage/supabase-storage.service';

type ManifestRow = { name: string; url: string; sizeKB: number; w: number | null; h: number | null; modified: number };

/* Central media management + CDN sorting. Disk-free: intrinsic asset metadata
   lives in the 'media_manifest' Postgres collection (committed static assets +
   appended uploads); per-name status overrides live in the 'media' collection;
   uploaded blobs live in the public Supabase Storage bucket. */
@Injectable()
export class MediaService {
  private readonly bucket = process.env.MEDIA_BUCKET || 'media';

  constructor(private readonly entities: EntityStore, private readonly storage: SupabaseStorage) {}

  private imageSize(b: Buffer): { w: number; h: number } | null {
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

  private categorize(f: string): string {
    if (/hero|banner/i.test(f)) return 'banner';
    if (/event-|tile/i.test(f)) return 'marketplace tile';
    if (/map|floor|venue/i.test(f)) return 'organizer map';
    return 'asset';
  }

  async listMedia() {
    const [manifest, statuses] = await Promise.all([
      this.entities.read<ManifestRow[]>('media_manifest', []),
      this.entities.read<Record<string, any>>('media', {}),
    ]);
    return manifest
      .map((r) => {
        const kb = r.sizeKB;
        const lowres = r.w && r.h ? r.w < 1000 || r.h < 600 : kb < 40;
        const meta = statuses[r.name] || {};
        return {
          name: r.name,
          url: r.url,
          cdnUrl: 'cdn.zora.com/img/' + crypto.createHash('md5').update(r.name).digest('hex').slice(0, 8) + '/' + r.name + '?w=1600&q=80&fm=webp',
          sizeKB: kb,
          optimizedKB: Math.max(6, Math.round(kb * 0.42)),
          dims: r.w && r.h ? r.w + '×' + r.h : '—',
          lowres,
          category: this.categorize(r.name),
          status: meta.status || (lowres ? 'flagged' : 'pending'),
          flagReason: meta.flagReason || (lowres ? 'Low resolution — below 1000px wide' : ''),
          modified: r.modified,
        };
      })
      .sort((a, b) => b.modified - a.modified);
  }

  async upload(name: string, dataUrl: string) {
    const m = /^data:image\/(jpe?g|png|webp|gif);base64,/.exec(dataUrl || '');
    if (!m) throw new BadRequestException({ error: 'Send a JPG, PNG, WEBP or GIF image' });
    const ext = m[1].replace('jpeg', 'jpg');
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    if (buf.length > 8 * 1024 * 1024) throw new BadRequestException({ error: 'Image is over 8MB' });
    const safe =
      String(name || 'image').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    const fname = Date.now().toString(36) + '-' + safe + '.' + ext;
    await this.storage.upload(this.bucket, fname, buf, 'image/' + (ext === 'jpg' ? 'jpeg' : ext));
    const url = this.storage.publicUrl(this.bucket, fname);
    const d = this.imageSize(buf);
    const manifest = await this.entities.read<ManifestRow[]>('media_manifest', []);
    manifest.push({ name: fname, url, sizeKB: Math.round(buf.length / 1024), w: d ? d.w : null, h: d ? d.h : null, modified: Date.now() });
    await this.entities.write('media_manifest', manifest);
    return { ok: true, name: fname, url };
  }
}
