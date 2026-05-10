import fs from 'fs';
import path from 'path';
import {
  CACHE_VERSION, REQUEST_TIMEOUT, FULLTEXT_MODE,
  FULLTEXT_CACHE_DIR, PDF_CACHE_EXPIRY, MAX_PDF_SIZE,
  PMC_BASE_URL, UNPAYWALL_API_URL,
} from '../config.js';
import {
  detectSystemEnvironment, downloadWithPowerShell, downloadWithWgetOrCurl,
} from './system.js';
import type { Article, OAInfo, DownloadResult, BatchDownloadItem } from '../types/article.js';

export class FulltextService {
  init(): void {
    try {
      if (!fs.existsSync(FULLTEXT_CACHE_DIR)) {
        fs.mkdirSync(FULLTEXT_CACHE_DIR, { recursive: true });
      }
      const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
      if (!fs.existsSync(indexPath)) {
        fs.writeFileSync(indexPath, JSON.stringify({
          version: CACHE_VERSION,
          created: new Date().toISOString(),
          fulltext_papers: {},
          stats: { totalPDFs: 0, totalSize: 0, lastCleanup: new Date().toISOString() },
        }, null, 2));
      }
      console.error(`[FullText] Initialized (mode: ${FULLTEXT_MODE})`);
    } catch (error) {
      console.error('[FullText] Init error:', (error as Error).message);
    }
  }

  async detectOpenAccess(article: Article): Promise<OAInfo> {
    const info: OAInfo = {
      isOpenAccess: false,
      sources: [],
      downloadUrl: null,
      pmcid: null,
      doi: article.doi,
    };

    try {
      const pmcInfo = await this.checkPMC(article.pmid);
      if (pmcInfo.isAvailable) {
        info.isOpenAccess = true;
        info.sources.push('PMC');
        info.downloadUrl = pmcInfo.downloadUrl ?? null;
        info.pmcid = pmcInfo.pmcid ?? null;
      }

      if (article.doi && !info.isOpenAccess) {
        const unpaywall = await this.checkUnpaywall(article.doi);
        if (unpaywall.isOpenAccess) {
          info.isOpenAccess = true;
          info.sources.push('Unpaywall');
          info.downloadUrl = unpaywall.downloadUrl ?? null;
        }
      }

      if (!info.isOpenAccess && article.doi) {
        const pub = await this.checkPublisherOA(article.doi);
        if (pub.isOpenAccess) {
          info.isOpenAccess = true;
          info.sources.push('Publisher');
          info.downloadUrl = pub.downloadUrl ?? null;
        }
      }
    } catch (error) {
      console.error(`[FullText] OA detection error for ${article.pmid}:`, (error as Error).message);
    }

    return info;
  }

  private async checkPMC(pmid: string): Promise<{ isAvailable: boolean; pmcid?: string; downloadUrl?: string }> {
    try {
      const resp = await fetch(`${PMC_BASE_URL}/?term=${pmid}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (resp.ok) {
        const html = await resp.text();
        const match = html.match(/PMC(\d+)/);
        if (match) {
          const pmcid = `PMC${match[1]}`;
          return { isAvailable: true, pmcid, downloadUrl: `${PMC_BASE_URL}/articles/${pmcid}/pdf/` };
        }
      }
    } catch (error) {
      console.error(`[FullText] PMC check error for ${pmid}:`, (error as Error).message);
    }
    return { isAvailable: false };
  }

  private async checkUnpaywall(doi: string): Promise<{ isOpenAccess: boolean; downloadUrl?: string }> {
    try {
      const email = process.env.PUBMED_EMAIL || 'user@example.com';
      const resp = await fetch(`${UNPAYWALL_API_URL}/${doi}?email=${email}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
      if (resp.ok) {
        const data = await resp.json() as { is_oa?: boolean; best_oa_location?: { url?: string } };
        if (data.is_oa && data.best_oa_location?.url) {
          return { isOpenAccess: true, downloadUrl: data.best_oa_location.url };
        }
      }
    } catch (error) {
      console.error(`[FullText] Unpaywall check error for ${doi}:`, (error as Error).message);
    }
    return { isOpenAccess: false };
  }

  private async checkPublisherOA(doi: string): Promise<{ isOpenAccess: boolean; downloadUrl?: string }> {
    try {
      const resp = await fetch(`https://doi.org/${doi}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)' },
      });
      if (resp.ok) {
        const html = await resp.text();
        const match = html.match(/href="([^"]*\.pdf[^"]*)"/i);
        if (match) return { isOpenAccess: true, downloadUrl: match[1] };
      }
    } catch (error) {
      console.error(`[FullText] Publisher OA check error for ${doi}:`, (error as Error).message);
    }
    return { isOpenAccess: false };
  }

  async downloadPDF(pmid: string, downloadUrl: string, oaInfo: OAInfo): Promise<DownloadResult> {
    try {
      const resp = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(60000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)',
          Accept: 'application/pdf,*/*;q=0.8',
        },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

      const len = resp.headers.get('content-length');
      if (len && parseInt(len) > MAX_PDF_SIZE) throw new Error(`PDF too large: ${len} bytes`);

      const buffer = Buffer.from(await resp.arrayBuffer());
      if (buffer.length > MAX_PDF_SIZE) throw new Error(`PDF too large: ${buffer.length} bytes`);

      const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
      fs.writeFileSync(pdfPath, buffer);
      await this.updateIndex(pmid, downloadUrl, oaInfo, buffer.length);

      return { success: true, filePath: pdfPath, fileSize: buffer.length, sources: oaInfo.sources };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async smartDownloadPDF(pmid: string, downloadUrl: string, oaInfo: OAInfo): Promise<DownloadResult> {
    const system = detectSystemEnvironment();
    const filePath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);

    try {
      const result = system.isWindows
        ? await downloadWithPowerShell(downloadUrl, filePath, system)
        : await downloadWithWgetOrCurl(downloadUrl, filePath, system);

      if (result.success) {
        await this.updateIndex(pmid, downloadUrl, oaInfo, result.fileSize || 0, system.downloadCommand);
      }
      return result;
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  async batchDownloadPDFs(downloadList: BatchDownloadItem[]): Promise<Array<{ pmid: string; title: string; result: DownloadResult }>> {
    const results: Array<{ pmid: string; title: string; result: DownloadResult }> = [];

    for (let i = 0; i < downloadList.length; i++) {
      const item = downloadList[i];
      try {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 2000 + 1000));
        const result = await this.smartDownloadPDF(item.pmid, item.downloadUrl, item.oaInfo);
        results.push({ pmid: item.pmid, title: item.title, result });

        if (i < downloadList.length - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.random() * 3000 + 2000));
        }
      } catch (error) {
        results.push({ pmid: item.pmid, title: item.title, result: { success: false, error: (error as Error).message } });
      }
    }
    return results;
  }

  isPDFCached(pmid: string): { cached: boolean; filePath?: string; fileSize?: number; age?: number } {
    try {
      const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
      if (fs.existsSync(pdfPath)) {
        const stat = fs.statSync(pdfPath);
        const age = Date.now() - stat.mtime.getTime();
        if (age < PDF_CACHE_EXPIRY) {
          return { cached: true, filePath: pdfPath, fileSize: stat.size, age };
        }
        fs.unlinkSync(pdfPath);
      }
    } catch (error) {
      console.error(`[FullText] Cache check error for ${pmid}:`, (error as Error).message);
    }
    return { cached: false };
  }

  private async updateIndex(
    pmid: string, downloadUrl: string, oaInfo: OAInfo,
    fileSize: number, method?: string,
  ): Promise<void> {
    try {
      const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
      const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      indexData.fulltext_papers[pmid] = {
        pmid, downloadUrl, sources: oaInfo.sources,
        filePath: `${pmid}.pdf`, fileSize,
        downloaded: new Date().toISOString(),
        pmcid: oaInfo.pmcid, doi: oaInfo.doi,
        ...(method && { downloadMethod: method }),
      };
      indexData.stats.totalPDFs = Object.keys(indexData.fulltext_papers).length;
      indexData.stats.totalSize = Object.values(indexData.fulltext_papers as Record<string, { fileSize?: number }>)
        .reduce((sum, p) => sum + (p.fileSize || 0), 0);
      fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    } catch (error) {
      console.error('[FullText] Index update error:', (error as Error).message);
    }
  }
}
