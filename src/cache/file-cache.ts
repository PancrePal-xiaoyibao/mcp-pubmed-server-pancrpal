import fs from 'fs';
import path from 'path';
import {
  PAPER_CACHE_DIR, CACHE_DIR, CACHE_VERSION, PAPER_CACHE_EXPIRY,
} from '../config.js';
import type { Article } from '../types/article.js';

export class FileCache {
  private _stats = { fileHits: 0, fileMisses: 0, fileSets: 0 };

  get stats() {
    return this._stats;
  }

  initDirectories(): void {
    for (const dir of [CACHE_DIR, PAPER_CACHE_DIR]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    const indexPath = path.join(CACHE_DIR, 'index.json');
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, JSON.stringify({
        version: CACHE_VERSION,
        created: new Date().toISOString(),
        papers: {},
        stats: { totalPapers: 0, lastCleanup: new Date().toISOString() },
      }, null, 2));
    }
  }

  getPaper(pmid: string): Article | null {
    try {
      const filePath = path.join(PAPER_CACHE_DIR, `${pmid}.json`);
      if (!fs.existsSync(filePath)) {
        this._stats.fileMisses++;
        return null;
      }
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtime.getTime() > PAPER_CACHE_EXPIRY) {
        fs.unlinkSync(filePath);
        this._stats.fileMisses++;
        return null;
      }
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this._stats.fileHits++;
      return data as Article;
    } catch {
      this._stats.fileMisses++;
      return null;
    }
  }

  setPaper(pmid: string, article: Article): void {
    try {
      const filePath = path.join(PAPER_CACHE_DIR, `${pmid}.json`);
      fs.writeFileSync(filePath, JSON.stringify(article, null, 2));
      this._stats.fileSets++;
    } catch (error) {
      console.error(`[FileCache] Error saving ${pmid}:`, (error as Error).message);
    }
  }

  getFileStats(): { totalFiles: number; totalSizeBytes: number } {
    try {
      if (!fs.existsSync(PAPER_CACHE_DIR)) return { totalFiles: 0, totalSizeBytes: 0 };
      const files = fs.readdirSync(PAPER_CACHE_DIR).filter(f => f.endsWith('.json'));
      let totalSize = 0;
      for (const file of files) {
        totalSize += fs.statSync(path.join(PAPER_CACHE_DIR, file)).size;
      }
      return { totalFiles: files.length, totalSizeBytes: totalSize };
    } catch {
      return { totalFiles: 0, totalSizeBytes: 0 };
    }
  }

  cleanExpired(): number {
    let cleaned = 0;
    try {
      if (!fs.existsSync(PAPER_CACHE_DIR)) return 0;
      const files = fs.readdirSync(PAPER_CACHE_DIR).filter(f => f.endsWith('.json'));
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(PAPER_CACHE_DIR, file);
        if (now - fs.statSync(filePath).mtime.getTime() > PAPER_CACHE_EXPIRY) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }
    } catch (error) {
      console.error('[FileCache] Error cleaning:', (error as Error).message);
    }
    return cleaned;
  }
}
