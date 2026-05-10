import fs from 'fs';
import path from 'path';
import {
  ABSTRACT_MODE, ABSTRACT_MAX_CHARS,
  FULLTEXT_ENABLED, FULLTEXT_MODE, FULLTEXT_AUTO_DOWNLOAD,
  PAPER_CACHE_DIR, CACHE_DIR, CACHE_VERSION, PAPER_CACHE_EXPIRY,
  FULLTEXT_CACHE_DIR, PDF_CACHE_EXPIRY,
} from '../config.js';
import { formatArticles } from '../utils/formatter.js';
import { truncateText, extractAbstractSections, extractKeyPoints } from '../utils/formatter.js';
import { detectSystemEnvironment, getSystemRecommendations, checkDownloadTools } from '../services/system.js';
import { PubMedClient } from '../api/pubmed-client.js';
import { MemoryCache } from '../cache/memory-cache.js';
import { FileCache } from '../cache/file-cache.js';
import { FulltextService } from '../services/fulltext.js';
import { ApiKeyPool } from '../api/key-pool.js';
import type { McpToolResponse, Suggestion } from '../types/responses.js';
import type { Article, BatchDownloadItem } from '../types/article.js';
import { makeResponse, makeError } from '../types/responses.js';

interface HandlerDeps {
  pubmedClient: PubMedClient;
  memoryCache: MemoryCache;
  fileCache: FileCache;
  fulltextService: FulltextService;
  apiKeyPool: ApiKeyPool;
}

export class ToolHandlers {
  private pubmedClient: PubMedClient;
  private memoryCache: MemoryCache;
  private fileCache: FileCache;
  private fulltextService: FulltextService;
  private apiKeyPool: ApiKeyPool;

  constructor(deps: HandlerDeps) {
    this.pubmedClient = deps.pubmedClient;
    this.memoryCache = deps.memoryCache;
    this.fileCache = deps.fileCache;
    this.fulltextService = deps.fulltextService;
    this.apiKeyPool = deps.apiKeyPool;
  }

  async route(name: string, args: Record<string, unknown>): Promise<McpToolResponse> {
    const handlers: Record<string, (a: Record<string, unknown>) => Promise<McpToolResponse>> = {
      pubmed_search: a => this.handleSearch(a),
      pubmed_get_details: a => this.handleGetDetails(a),
      pubmed_extract_info: a => this.handleExtractInfo(a),
      pubmed_find_related: a => this.handleFindRelated(a),
      pubmed_manage_cache: a => this.handleManageCache(a),
      pubmed_detect_fulltext: a => this.handleDetectFulltext(a),
      pubmed_download_fulltext: a => this.handleDownloadFulltext(a),
      pubmed_system_status: a => this.handleSystemStatus(),
    };

    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return handler(args);
  }

  private async handleSearch(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const query = args.query as string;
    const maxResults = Math.min((args.max_results as number) || 20, 100);
    const daysBack = (args.days_back as number) || 0;
    const sortBy = (args.sort_by as string) || 'relevance';
    const format = (args.format as 'compact' | 'standard' | 'detailed') || 'standard';

    const result = await this.pubmedClient.search(query, maxResults, daysBack, sortBy);

    if (result.articles.length === 0) {
      return makeResponse('pubmed_search', {
        query: result.query,
        articles: [],
      }, t, {
        pagination: { total: 0, returned: 0, hasMore: false },
        suggestions: [
          { tool: 'pubmed_search', reason: 'Try broader terms, different MeSH headings, or remove date filters.', parameters: { query } },
        ],
      });
    }

    const articles = formatArticles(result.articles, format);
    const suggestions: Suggestion[] = [];

    if (result.articles.length > 0) {
      suggestions.push({
        tool: 'pubmed_get_details',
        reason: 'Get full metadata for specific articles of interest.',
        parameters: { pmids: result.articles.slice(0, 3).map(a => a.pmid) },
      });
    }
    if (Number(result.total) > maxResults) {
      suggestions.push({
        tool: 'pubmed_search',
        reason: `${result.total} total results found. Refine query or increase max_results to see more.`,
      });
    }
    if (FULLTEXT_ENABLED && result.articles.length > 0) {
      suggestions.push({
        tool: 'pubmed_detect_fulltext',
        reason: 'Check if key articles have freely available full-text PDFs.',
        parameters: { pmid: result.articles[0].pmid },
      });
    }

    return makeResponse('pubmed_search', {
      query: result.query,
      articles,
      searchParams: { maxResults, daysBack, sortBy, format },
    }, t, {
      pagination: { total: Number(result.total), returned: result.articles.length, hasMore: Number(result.total) > maxResults },
      suggestions,
    });
  }

  private async handleGetDetails(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const pmids = Array.isArray(args.pmids) ? args.pmids as string[] : [args.pmids as string];
    const rawFormat = (args.format as string) || 'standard';
    const format = (rawFormat === 'concise' ? 'compact' : rawFormat) as 'compact' | 'standard' | 'detailed';

    if (pmids.length > 20) {
      return makeError('pubmed_get_details', 'LIMIT_EXCEEDED', 'Maximum 20 PMIDs per request.', t);
    }

    const articles = await this.pubmedClient.fetchArticleDetails(pmids);
    const formatted = formatArticles(articles, format);

    const suggestions: Suggestion[] = [];
    if (articles.length > 0) {
      suggestions.push({
        tool: 'pubmed_find_related',
        reason: 'Discover related articles to expand your literature review.',
        parameters: { pmid: articles[0].pmid },
      });
      suggestions.push({
        tool: 'pubmed_extract_info',
        reason: 'Extract structured sections (abstract parts, keywords) for deeper analysis.',
        parameters: { pmid: articles[0].pmid },
      });
    }

    return makeResponse('pubmed_get_details', {
      articles: formatted,
    }, t, {
      pagination: { total: pmids.length, returned: articles.length, hasMore: false },
      suggestions,
    });
  }

  private async handleExtractInfo(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const pmid = args.pmid as string;
    const sections = (args.sections as string[]) || ['basic_info', 'abstract_summary', 'authors'];

    const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
    if (articles.length === 0) {
      return makeError('pubmed_extract_info', 'NOT_FOUND', `No article found for PMID ${pmid}.`, t);
    }

    const article = articles[0];
    const extracted: Record<string, unknown> = {};

    if (sections.includes('basic_info')) {
      extracted.basic_info = {
        pmid: article.pmid, title: article.title, journal: article.journal,
        publicationDate: article.publicationDate, volume: article.volume,
        issue: article.issue, pages: article.pages, doi: article.doi,
        url: article.url, publicationTypes: article.publicationTypes,
      };
    }

    if (sections.includes('authors')) {
      extracted.authors = {
        list: article.authors,
        firstAuthor: article.authors[0] || null,
        lastAuthor: article.authors.at(-1) || null,
        count: article.authors.length,
      };
    }

    if (sections.includes('abstract_summary') && article.abstract) {
      const truncated = truncateText(article.abstract, ABSTRACT_MAX_CHARS);
      extracted.abstract_summary = {
        text: truncated,
        structured: extractAbstractSections(truncated),
        keyPoints: extractKeyPoints(truncated),
        wordCount: truncated.split(/\s+/).length,
      };
    }

    if (sections.includes('keywords')) {
      extracted.keywords = {
        meshTerms: article.meshTerms || [],
        keywords: article.keywords || [],
        combined: [...(article.meshTerms || []), ...(article.keywords || [])].slice(0, 15),
      };
    }

    if (sections.includes('doi_link') && article.doi) {
      extracted.doi_link = {
        doi: article.doi,
        url: article.doi.startsWith('10.') ? `https://doi.org/${article.doi}` : article.url,
      };
    }

    return makeResponse('pubmed_extract_info', {
      pmid,
      sections: extracted,
      abstractMode: ABSTRACT_MODE,
    }, t, {
      suggestions: [
        { tool: 'pubmed_find_related', reason: 'Find related articles for cross-referencing.', parameters: { pmid } },
      ],
    });
  }

  private async handleFindRelated(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const pmid = args.pmid as string;
    const type = (args.type as string) || 'similar';
    const maxResults = (args.max_results as number) || 10;

    const queryMap: Record<string, string> = {
      similar: `${pmid}[uid]`,
      reviews: `${pmid}[uid] AND review[publication type]`,
    };

    const result = await this.pubmedClient.search(queryMap[type] || queryMap.similar, maxResults, 0, 'relevance');
    const articles = formatArticles(result.articles, 'standard');

    return makeResponse('pubmed_find_related', {
      basePmid: pmid,
      relationshipType: type,
      articles,
    }, t, {
      pagination: { total: result.articles.length, returned: result.articles.length, hasMore: false },
      suggestions: result.articles.length > 0
        ? [{ tool: 'pubmed_get_details', reason: 'Get full details for the most relevant related articles.', parameters: { pmids: result.articles.slice(0, 3).map(a => a.pmid) } }]
        : [],
    });
  }

  private async handleManageCache(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const action = (args.action as string) || 'stats';
    const target = (args.target as string) || 'all';

    if (action === 'stats') {
      const memStats = this.memoryCache.stats;
      const memHitRate = (memStats.hits + memStats.misses) > 0
        ? (memStats.hits / (memStats.hits + memStats.misses) * 100).toFixed(1) + '%'
        : 'N/A';
      const fileStats = this.fileCache.stats;
      const fileHitRate = (fileStats.fileHits + fileStats.fileMisses) > 0
        ? (fileStats.fileHits / (fileStats.fileHits + fileStats.fileMisses) * 100).toFixed(1) + '%'
        : 'N/A';
      const fileInfo = this.fileCache.getFileStats();

      return makeResponse('pubmed_manage_cache', {
        memory: {
          entries: this.memoryCache.size,
          maxEntries: this.memoryCache.maxSize,
          hitRate: memHitRate,
          hits: memStats.hits,
          misses: memStats.misses,
          timeoutMinutes: this.memoryCache.timeout / 60000,
        },
        files: {
          totalFiles: fileInfo.totalFiles,
          totalSizeBytes: fileInfo.totalSizeBytes,
          hitRate: fileHitRate,
          hits: fileStats.fileHits,
          misses: fileStats.fileMisses,
          expiryDays: PAPER_CACHE_EXPIRY / (24 * 3600000),
          directory: PAPER_CACHE_DIR,
        },
      }, t, {
        suggestions: [
          { tool: 'pubmed_manage_cache', reason: 'Clean expired entries to free space.', parameters: { action: 'clean', target: 'all' } },
        ],
      });
    }

    if (action === 'clean') {
      const results: Record<string, number> = {};
      if (target === 'memory' || target === 'all') {
        results.memoryCleaned = this.memoryCache.cleanExpired();
      }
      if (target === 'files' || target === 'all') {
        results.filesCleaned = this.fileCache.cleanExpired();
      }
      if ((target === 'fulltext' || target === 'all') && FULLTEXT_ENABLED) {
        results.fulltextCleaned = this.cleanFulltextCache();
      }
      return makeResponse('pubmed_manage_cache', { action: 'clean', results }, t);
    }

    if (action === 'clear') {
      const results: Record<string, number> = {};
      if (target === 'memory' || target === 'all') {
        results.memoryCleared = this.memoryCache.clear();
      }
      if (target === 'files' || target === 'all') {
        results.filesCleared = this.clearFileCache();
      }
      if ((target === 'fulltext' || target === 'all') && FULLTEXT_ENABLED) {
        results.fulltextCleared = this.clearFulltextCache();
      }
      return makeResponse('pubmed_manage_cache', { action: 'clear', results }, t);
    }

    return makeError('pubmed_manage_cache', 'INVALID_ACTION', `Unknown action: ${action}`, t);
  }

  private async handleDetectFulltext(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const pmid = args.pmid as string;
    const autoDownload = (args.auto_download as boolean) || false;

    if (!FULLTEXT_ENABLED) {
      return makeError('pubmed_detect_fulltext', 'DISABLED',
        'Full-text mode is disabled. Set FULLTEXT_MODE=enabled in environment.', t);
    }

    const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
    if (articles.length === 0) {
      return makeError('pubmed_detect_fulltext', 'NOT_FOUND', `No article found for PMID ${pmid}.`, t);
    }

    const article = articles[0];
    const oaInfo = await this.fulltextService.detectOpenAccess(article);

    let downloadResult = null;
    if (oaInfo.isOpenAccess && (autoDownload || FULLTEXT_AUTO_DOWNLOAD)) {
      const cached = this.fulltextService.isPDFCached(pmid);
      if (!cached.cached && oaInfo.downloadUrl) {
        downloadResult = await this.fulltextService.downloadPDF(pmid, oaInfo.downloadUrl, oaInfo);
      } else if (cached.cached) {
        downloadResult = { success: true, cached: true, filePath: cached.filePath, fileSize: cached.fileSize };
      }
    }

    const suggestions: Suggestion[] = [];
    if (oaInfo.isOpenAccess && !downloadResult) {
      suggestions.push({
        tool: 'pubmed_download_fulltext',
        reason: 'Full-text is available. Download the PDF.',
        parameters: { pmids: pmid },
      });
    }

    return makeResponse('pubmed_detect_fulltext', {
      pmid,
      article: { title: article.title, journal: article.journal, doi: article.doi },
      openAccess: {
        available: oaInfo.isOpenAccess,
        sources: oaInfo.sources,
        downloadUrl: oaInfo.downloadUrl,
        pmcid: oaInfo.pmcid,
      },
      download: downloadResult,
    }, t, { suggestions });
  }

  private async handleDownloadFulltext(args: Record<string, unknown>): Promise<McpToolResponse> {
    const t = Date.now();
    const pmids = Array.isArray(args.pmids) ? args.pmids as string[] : [args.pmids as string];
    const force = (args.force as boolean) || false;

    if (!FULLTEXT_ENABLED) {
      return makeError('pubmed_download_fulltext', 'DISABLED',
        'Full-text mode is disabled. Set FULLTEXT_MODE=enabled in environment.', t);
    }

    if (pmids.length > 10) {
      return makeError('pubmed_download_fulltext', 'LIMIT_EXCEEDED', 'Maximum 10 PMIDs per batch.', t);
    }

    if (pmids.length === 1) {
      return this.downloadSingle(pmids[0], force, t);
    }

    return this.downloadBatch(pmids, t);
  }

  private async downloadSingle(pmid: string, force: boolean, t: number): Promise<McpToolResponse> {
    if (!force) {
      const cached = this.fulltextService.isPDFCached(pmid);
      if (cached.cached) {
        return makeResponse('pubmed_download_fulltext', {
          pmid,
          status: 'already_cached',
          filePath: cached.filePath,
          fileSize: cached.fileSize,
          ageHours: Math.round((cached.age || 0) / 3600000),
        }, t, { cached: true });
      }
    }

    const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
    if (articles.length === 0) {
      return makeError('pubmed_download_fulltext', 'NOT_FOUND', `No article found for PMID ${pmid}.`, t);
    }

    const oaInfo = await this.fulltextService.detectOpenAccess(articles[0]);
    if (!oaInfo.isOpenAccess || !oaInfo.downloadUrl) {
      return makeError('pubmed_download_fulltext', 'NOT_OA',
        'No open access full-text available for this article.', t,
        [{ tool: 'pubmed_detect_fulltext', reason: 'Check alternative OA sources.', parameters: { pmid } }]);
    }

    const result = await this.fulltextService.smartDownloadPDF(pmid, oaInfo.downloadUrl, oaInfo);

    return makeResponse('pubmed_download_fulltext', {
      pmid,
      download: result,
      openAccess: { sources: oaInfo.sources, pmcid: oaInfo.pmcid },
    }, t);
  }

  private async downloadBatch(pmids: string[], t: number): Promise<McpToolResponse> {
    const downloadList: BatchDownloadItem[] = [];

    for (const pmid of pmids) {
      const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
      if (articles.length > 0) {
        const oaInfo = await this.fulltextService.detectOpenAccess(articles[0]);
        if (oaInfo.isOpenAccess && oaInfo.downloadUrl) {
          downloadList.push({ pmid, title: articles[0].title, downloadUrl: oaInfo.downloadUrl, oaInfo });
        }
      }
    }

    if (downloadList.length === 0) {
      return makeResponse('pubmed_download_fulltext', {
        requested: pmids.length,
        availableForDownload: 0,
        message: 'No open access papers found for any of the requested PMIDs.',
      }, t);
    }

    const results = await this.fulltextService.batchDownloadPDFs(downloadList);
    const successful = results.filter(r => r.result.success).length;

    return makeResponse('pubmed_download_fulltext', {
      requested: pmids.length,
      availableForDownload: downloadList.length,
      successfulDownloads: successful,
      failedDownloads: results.length - successful,
      results,
    }, t);
  }

  private async handleSystemStatus(): Promise<McpToolResponse> {
    const t = Date.now();
    const systemInfo = await checkDownloadTools();

    return makeResponse('pubmed_system_status', {
      system: systemInfo,
      apiKeyPool: this.apiKeyPool.getStatus(),
      fulltextMode: { enabled: FULLTEXT_ENABLED, mode: FULLTEXT_MODE, autoDownload: FULLTEXT_AUTO_DOWNLOAD },
      recommendations: getSystemRecommendations(systemInfo),
    }, t);
  }

  private cleanFulltextCache(): number {
    let cleaned = 0;
    try {
      const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
      if (!fs.existsSync(indexPath)) return 0;
      const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      const now = Date.now();

      for (const [pmid] of Object.entries(indexData.fulltext_papers as Record<string, unknown>)) {
        const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
        if (fs.existsSync(pdfPath)) {
          if (now - fs.statSync(pdfPath).mtime.getTime() > PDF_CACHE_EXPIRY) {
            fs.unlinkSync(pdfPath);
            delete indexData.fulltext_papers[pmid];
            cleaned++;
          }
        }
      }

      if (cleaned > 0) {
        indexData.stats.totalPDFs = Object.keys(indexData.fulltext_papers).length;
        indexData.stats.lastCleanup = new Date().toISOString();
        fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
      }
    } catch (error) {
      console.error('[Cache] Fulltext clean error:', (error as Error).message);
    }
    return cleaned;
  }

  private clearFulltextCache(): number {
    let deleted = 0;
    try {
      if (fs.existsSync(FULLTEXT_CACHE_DIR)) {
        for (const file of fs.readdirSync(FULLTEXT_CACHE_DIR)) {
          if (file.endsWith('.pdf')) {
            fs.unlinkSync(path.join(FULLTEXT_CACHE_DIR, file));
            deleted++;
          }
        }
      }
      const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
      fs.writeFileSync(indexPath, JSON.stringify({
        version: CACHE_VERSION,
        created: new Date().toISOString(),
        fulltext_papers: {},
        stats: { totalPDFs: 0, totalSize: 0, lastCleanup: new Date().toISOString() },
      }, null, 2));
    } catch (error) {
      console.error('[Cache] Fulltext clear error:', (error as Error).message);
    }
    return deleted;
  }

  private clearFileCache(): number {
    let deleted = 0;
    try {
      if (fs.existsSync(PAPER_CACHE_DIR)) {
        for (const file of fs.readdirSync(PAPER_CACHE_DIR)) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(path.join(PAPER_CACHE_DIR, file));
            deleted++;
          }
        }
      }
      const indexPath = path.join(CACHE_DIR, 'index.json');
      fs.writeFileSync(indexPath, JSON.stringify({
        version: CACHE_VERSION,
        created: new Date().toISOString(),
        papers: {},
        stats: { totalPapers: 0, lastCleanup: new Date().toISOString() },
      }, null, 2));
    } catch (error) {
      console.error('[Cache] File clear error:', (error as Error).message);
    }
    return deleted;
  }
}
