import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

/* JSON file store — the exact readJson/writeJson helpers from server.js, wrapped
   as an injectable. DATA_DIR is resolved once (absolute) from ZORA_DATA_DIR so the
   api shares the legacy oracle's store during migration. */
@Injectable()
export class FileStore {
  readonly dataDir: string;

  constructor() {
    const raw = process.env.ZORA_DATA_DIR || path.join(__dirname, '..', '..', 'data');
    this.dataDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }

  path(name: string): string {
    return path.join(this.dataDir, name);
  }

  readJson<T>(name: string, fallback: T): T {
    try {
      return JSON.parse(fs.readFileSync(this.path(name), 'utf8'));
    } catch {
      return fallback;
    }
  }

  writeJson(name: string, data: unknown): void {
    fs.writeFileSync(this.path(name), JSON.stringify(data, null, 2), 'utf8');
  }
}
