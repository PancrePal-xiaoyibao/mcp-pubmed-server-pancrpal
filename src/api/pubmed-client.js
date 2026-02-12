import fetch from 'node-fetch';
import { URL } from 'url';
import {
    PUBMED_BASE_URL, RATE_LIMIT_DELAY, REQUEST_TIMEOUT, ABSTRACT_MODE
} from '../config.js';

export class PubMedClient {
    constructor({ memoryCache, fileCache }) {
        this.memoryCache = memoryCache;
        this.fileCache = fileCache;
        this.lastRequestTime = 0;
    }

    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    async search(query, maxResults = 20, daysBack = 0, sortBy = "relevance") {
        // 检查缓存
        const cacheKey = this.memoryCache.getCacheKey(query, maxResults, daysBack, sortBy);
        const cachedResult = this.memoryCache.get(cacheKey);
        if (cachedResult) {
            return cachedResult;
        }

        await this.enforceRateLimit();

        // 构建搜索查询
        let searchQuery = query;
        if (daysBack > 0) {
            const date = new Date();
            date.setDate(date.getDate() - daysBack);
            const dateStr = date.toISOString().split('T')[0];
            searchQuery += ` AND ("${dateStr}"[Date - Publication] : "3000"[Date - Publication])`;
        }

        // 添加排序参数
        const sortMap = {
            "relevance": "relevance",
            "date": "pub+date",
            "pubdate": "pub+date"
        };

        const searchUrl = new URL(`${PUBMED_BASE_URL}/esearch.fcgi`);
        searchUrl.searchParams.append('db', 'pubmed');
        searchUrl.searchParams.append('term', searchQuery);
        searchUrl.searchParams.append('retmax', maxResults.toString());
        searchUrl.searchParams.append('retmode', 'json');
        searchUrl.searchParams.append('sort', sortMap[sortBy] || 'relevance');
        searchUrl.searchParams.append('tool', 'mcp-pubmed-server');
        searchUrl.searchParams.append('email', process.env.PUBMED_EMAIL || 'user@example.com');

        if (process.env.PUBMED_API_KEY) {
            searchUrl.searchParams.append('api_key', process.env.PUBMED_API_KEY);
        }

        const response = await fetch(searchUrl.toString(), {
            timeout: REQUEST_TIMEOUT
        });
        if (!response.ok) {
            throw new Error(`PubMed search failed: ${response.statusText}`);
        }

        const data = await response.json();
        const ids = data.esearchresult?.idlist || [];

        if (ids.length === 0) {
            return { articles: [], total: 0, query: searchQuery };
        }

        const articles = await this.fetchArticleDetails(ids);
        const result = { articles, total: data.esearchresult?.count || 0, query: searchQuery };

        // 缓存结果
        this.memoryCache.set(cacheKey, result);

        return result;
    }

    async fetchArticleDetails(ids) {
        const articles = [];
        const uncachedIds = [];

        // 首先检查文件缓存
        for (const id of ids) {
            const cachedArticle = this.fileCache.getPaper(id);
            if (cachedArticle) {
                articles.push(cachedArticle);
            } else {
                uncachedIds.push(id);
            }
        }

        // 如果有未缓存的文章，从PubMed获取
        if (uncachedIds.length > 0) {
            console.error(`[Cache] Fetching ${uncachedIds.length} uncached articles from PubMed`);
            const newArticles = await this.fetchFromPubMed(uncachedIds);

            // 将新获取的文章保存到文件缓存
            for (const article of newArticles) {
                this.fileCache.setPaper(article.pmid, article);
            }

            articles.push(...newArticles);
        }

        // 按原始ID顺序排序
        return ids.map(id => articles.find(article => article.pmid === id));
    }

    async fetchFromPubMed(ids) {
        await this.enforceRateLimit();

        const summaryUrl = new URL(`${PUBMED_BASE_URL}/esummary.fcgi`);
        summaryUrl.searchParams.append('db', 'pubmed');
        summaryUrl.searchParams.append('id', ids.join(','));
        summaryUrl.searchParams.append('retmode', 'json');
        summaryUrl.searchParams.append('tool', 'mcp-pubmed-server');
        summaryUrl.searchParams.append('email', process.env.PUBMED_EMAIL || 'user@example.com');

        if (process.env.PUBMED_API_KEY) {
            summaryUrl.searchParams.append('api_key', process.env.PUBMED_API_KEY);
        }

        const response = await fetch(summaryUrl.toString(), {
            timeout: REQUEST_TIMEOUT
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch article details: ${response.statusText}`);
        }

        const data = await response.json();

        const articles = ids.map(id => {
            // PubMed `esummary` can occasionally omit an id entry; guard to avoid crashes.
            const article = data?.result?.[id] ?? {};
            return {
                pmid: id,
                title: article.title || 'No title',
                authors: article.authors?.map(author => author.name) || [],
                journal: article.source || 'No journal',
                publicationDate: article.pubdate || 'No date',
                volume: article.volume || '',
                issue: article.issue || '',
                pages: article.pages || '',
                abstract: article.abstract || null,
                doi: article.elocationid || '',
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                publicationTypes: article.pubtype || [],
                meshTerms: article.meshterms || [],
                keywords: article.keywords || []
            };
        });

        // 如果是 deep 模式，尝试获取完整摘要
        if (ABSTRACT_MODE === 'deep') {
            for (let article of articles) {
                try {
                    if (!article.abstract || article.abstract.length < 1000) {
                        article.abstract = await this.fetchFullAbstract(article.pmid);
                    }
                } catch (error) {
                    console.warn(`Failed to fetch full abstract for ${article.pmid}:`, error.message);
                }
            }
        }

        return articles;
    }

    async fetchFullAbstract(pmid) {
        await this.enforceRateLimit();

        const abstractUrl = new URL(`${PUBMED_BASE_URL}/efetch.fcgi`);
        abstractUrl.searchParams.append('db', 'pubmed');
        abstractUrl.searchParams.append('id', pmid);
        abstractUrl.searchParams.append('rettype', 'abstract');
        abstractUrl.searchParams.append('retmode', 'text');
        abstractUrl.searchParams.append('tool', 'mcp-pubmed-server');
        abstractUrl.searchParams.append('email', process.env.PUBMED_EMAIL || 'user@example.com');

        if (process.env.PUBMED_API_KEY) {
            abstractUrl.searchParams.append('api_key', process.env.PUBMED_API_KEY);
        }

        const response = await fetch(abstractUrl.toString(), {
            timeout: REQUEST_TIMEOUT
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch abstract: ${response.statusText}`);
        }

        return await response.text();
    }
}
