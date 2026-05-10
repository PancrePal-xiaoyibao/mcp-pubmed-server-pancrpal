import { URL } from 'url';
import { PUBMED_BASE_URL, REQUEST_TIMEOUT, ABSTRACT_MODE } from '../config.js';
import { ApiKeyPool } from './key-pool.js';
import { MemoryCache } from '../cache/memory-cache.js';
import { FileCache } from '../cache/file-cache.js';
import type { Article, SearchResult } from '../types/article.js';

interface PubMedClientDeps {
  memoryCache: MemoryCache;
  fileCache: FileCache;
  apiKeyPool: ApiKeyPool;
}

export class PubMedClient {
  private memoryCache: MemoryCache;
  private fileCache: FileCache;
  private apiKeyPool: ApiKeyPool;
  private lastRequestTime = 0;

  constructor({ memoryCache, fileCache, apiKeyPool }: PubMedClientDeps) {
    this.memoryCache = memoryCache;
    this.fileCache = fileCache;
    this.apiKeyPool = apiKeyPool;
  }

  private async enforceRateLimit(): Promise<void> {
    const delay = this.apiKeyPool.getRateLimitDelay();
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < delay) {
      await new Promise(resolve => setTimeout(resolve, delay - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  private applyCredentials(url: URL): { apiKey: string; email: string } | null {
    const key = this.apiKeyPool.getKey();
    url.searchParams.append('tool', 'mcp-pubmed-server');
    if (key) {
      url.searchParams.append('email', key.email);
      url.searchParams.append('api_key', key.apiKey);
    } else {
      url.searchParams.append('email', process.env.PUBMED_EMAIL || 'user@example.com');
    }
    return key;
  }

  async search(
    query: string,
    maxResults = 20,
    daysBack = 0,
    sortBy = 'relevance',
  ): Promise<SearchResult> {
    const cacheKey = this.memoryCache.getCacheKey(query, maxResults, daysBack, sortBy);
    const cached = this.memoryCache.get<SearchResult>(cacheKey);
    if (cached) return cached;

    await this.enforceRateLimit();

    let searchQuery = query;
    if (daysBack > 0) {
      const d = new Date();
      d.setDate(d.getDate() - daysBack);
      searchQuery += ` AND ("${d.toISOString().split('T')[0]}"[Date - Publication] : "3000"[Date - Publication])`;
    }

    const sortMap: Record<string, string> = {
      relevance: 'relevance',
      date: 'pub+date',
      pubdate: 'pub+date',
    };

    const url = new URL(`${PUBMED_BASE_URL}/esearch.fcgi`);
    url.searchParams.append('db', 'pubmed');
    url.searchParams.append('term', searchQuery);
    url.searchParams.append('retmax', maxResults.toString());
    url.searchParams.append('retmode', 'json');
    url.searchParams.append('sort', sortMap[sortBy] || 'relevance');
    const usedKey = this.applyCredentials(url);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    } catch (error) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw error;
    }

    if (!response.ok) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw new Error(`PubMed search failed: ${response.statusText}`);
    }
    if (usedKey) this.apiKeyPool.reportSuccess(usedKey.apiKey);

    const data = await response.json() as { esearchresult?: { idlist?: string[]; count?: number } };
    const ids = data.esearchresult?.idlist || [];

    if (ids.length === 0) {
      return { articles: [], total: 0, query: searchQuery };
    }

    const articles = await this.fetchArticleDetails(ids);
    const result: SearchResult = {
      articles,
      total: Number(data.esearchresult?.count || 0),
      query: searchQuery,
    };
    this.memoryCache.set(cacheKey, result);
    return result;
  }

  async fetchArticleDetails(ids: string[]): Promise<Article[]> {
    const articles: Article[] = [];
    const uncachedIds: string[] = [];

    for (const id of ids) {
      const cached = this.fileCache.getPaper(id);
      if (cached) {
        articles.push(cached);
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length > 0) {
      const fetched = await this.fetchFromPubMed(uncachedIds);
      for (const article of fetched) {
        this.fileCache.setPaper(article.pmid, article);
      }
      articles.push(...fetched);
    }

    return ids
      .map(id => articles.find(a => a.pmid === id))
      .filter((a): a is Article => a !== undefined);
  }

  private async fetchFromPubMed(ids: string[]): Promise<Article[]> {
    await this.enforceRateLimit();

    const url = new URL(`${PUBMED_BASE_URL}/esummary.fcgi`);
    url.searchParams.append('db', 'pubmed');
    url.searchParams.append('id', ids.join(','));
    url.searchParams.append('retmode', 'json');
    const usedKey = this.applyCredentials(url);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    } catch (error) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw error;
    }

    if (!response.ok) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw new Error(`Failed to fetch article details: ${response.statusText}`);
    }
    if (usedKey) this.apiKeyPool.reportSuccess(usedKey.apiKey);

    const data = await response.json() as { result?: Record<string, Record<string, unknown>> };

    const articles: Article[] = ids.map(id => {
      const r = data?.result?.[id] ?? {};
      return {
        pmid: id,
        title: (r.title as string) || 'No title',
        authors: ((r.authors as Array<{ name: string }>) || []).map(a => a.name),
        journal: (r.source as string) || 'No journal',
        publicationDate: (r.pubdate as string) || 'No date',
        volume: (r.volume as string) || '',
        issue: (r.issue as string) || '',
        pages: (r.pages as string) || '',
        abstract: (r.abstract as string) || null,
        doi: (r.elocationid as string) || '',
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        publicationTypes: (r.pubtype as string[]) || [],
        meshTerms: (r.meshterms as string[]) || [],
        keywords: (r.keywords as string[]) || [],
      };
    });

    if (ABSTRACT_MODE === 'deep') {
      for (const article of articles) {
        if (!article.abstract || article.abstract.length < 1000) {
          try {
            article.abstract = await this.fetchFullAbstract(article.pmid);
          } catch (error) {
            console.warn(`Failed to fetch full abstract for ${article.pmid}:`, (error as Error).message);
          }
        }
      }
    }

    return articles;
  }

  async fetchFullAbstract(pmid: string): Promise<string> {
    await this.enforceRateLimit();

    const url = new URL(`${PUBMED_BASE_URL}/efetch.fcgi`);
    url.searchParams.append('db', 'pubmed');
    url.searchParams.append('id', pmid);
    url.searchParams.append('rettype', 'abstract');
    url.searchParams.append('retmode', 'text');
    const usedKey = this.applyCredentials(url);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    } catch (error) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw error;
    }

    if (!response.ok) {
      if (usedKey) this.apiKeyPool.reportFailure(usedKey.apiKey);
      throw new Error(`Failed to fetch abstract: ${response.statusText}`);
    }
    if (usedKey) this.apiKeyPool.reportSuccess(usedKey.apiKey);

    return await response.text();
  }
}
