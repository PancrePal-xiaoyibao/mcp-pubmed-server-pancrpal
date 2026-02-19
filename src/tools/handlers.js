import fs from 'fs';
import path from 'path';
import {
    ABSTRACT_MODE, ABSTRACT_MAX_CHARS, ENDNOTE_EXPORT_ENABLED,
    FULLTEXT_MODE, FULLTEXT_ENABLED, FULLTEXT_AUTO_DOWNLOAD,
    PAPER_CACHE_DIR, CACHE_DIR, CACHE_VERSION, PAPER_CACHE_EXPIRY,
    FULLTEXT_CACHE_DIR, PDF_CACHE_EXPIRY, ENDNOTE_CACHE_DIR
} from '../config.js';
import { formatForLLM, truncateText, extractAbstractSections, extractKeyPoints } from '../utils/formatter.js';
import { detectSystemEnvironment, getSystemRecommendations, checkDownloadTools } from '../services/system.js';

export class ToolHandlers {
    constructor({ pubmedClient, memoryCache, fileCache, fulltextService, endnoteService, apiKeyPool }) {
        this.pubmedClient = pubmedClient;
        this.memoryCache = memoryCache;
        this.fileCache = fileCache;
        this.fulltextService = fulltextService;
        this.endnoteService = endnoteService;
        this.apiKeyPool = apiKeyPool;
    }

    async route(name, args) {
        switch (name) {
            case "pubmed_search":
                return await this.handleSearch(args);
            case "pubmed_quick_search":
                return await this.handleQuickSearch(args);
            case "pubmed_cache_info":
                return await this.handleCacheInfo(args);
            case "pubmed_get_details":
                return await this.handleGetDetails(args);
            case "pubmed_extract_key_info":
                return await this.handleExtractKeyInfo(args);
            case "pubmed_cross_reference":
                return await this.handleCrossReference(args);
            case "pubmed_batch_query":
                return await this.handleBatchQuery(args);
            case "pubmed_detect_fulltext":
                return await this.handleDetectFulltext(args);
            case "pubmed_download_fulltext":
                return await this.handleDownloadFulltext(args);
            case "pubmed_fulltext_status":
                return await this.handleFulltextStatus(args);
            case "pubmed_batch_download":
                return await this.handleBatchDownload(args);
            case "pubmed_system_check":
                return await this.handleSystemCheck(args);
            case "pubmed_endnote_status":
                return await this.handleEndNoteStatus(args);
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async handleSearch(args) {
        const { query, max_results = 20, page_size = 20, days_back = 0, include_abstract = true, sort_by = "relevance", response_format = "standard" } = args;

        const effectiveMaxResults = Math.min(max_results, page_size);
        const isLargeQuery = max_results > 50;

        console.error(`[PubMed Search] Starting search for: "${query}" (max_results=${max_results}, page_size=${page_size}, effective=${effectiveMaxResults})`);
        const startTime = Date.now();

        try {
            const result = await this.pubmedClient.search(query, effectiveMaxResults, days_back, sort_by);
            const endTime = Date.now();
            console.error(`[PubMed Search] Completed in ${endTime - startTime}ms, found ${result.articles.length} articles`);

            if (result.articles.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            total: 0,
                            query: result.query,
                            message: "未找到匹配的文献",
                            articles: []
                        }, null, 2)
                    }]
                };
            }

            const formattedArticles = formatForLLM(result.articles, "llm_optimized", response_format);

            let endnoteExport = null;
            if (ENDNOTE_EXPORT_ENABLED && result.articles.length > 0) {
                try {
                    endnoteExport = await this.endnoteService.autoExport(result.articles);
                    console.error(`[EndNote] Auto-exported ${endnoteExport.exported} papers to EndNote formats`);
                } catch (error) {
                    console.error(`[EndNote] Auto-export failed:`, error.message);
                }
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        total: result.total,
                        query: result.query,
                        found: result.articles.length,
                        articles: formattedArticles,
                        search_metadata: {
                            max_results: max_results,
                            page_size: page_size,
                            effective_results: effectiveMaxResults,
                            days_back: days_back,
                            sort_by: sort_by,
                            include_abstract: include_abstract,
                            response_format: response_format,
                            is_large_query: isLargeQuery,
                            performance_note: isLargeQuery ? "Large query detected. Consider using page_size parameter for better performance." : null
                        },
                        endnote_export: endnoteExport
                    }, null, 2)
                }]
            };
        } catch (error) {
            const endTime = Date.now();
            console.error(`[PubMed Search] Error after ${endTime - startTime}ms:`, error.message);
            throw error;
        }
    }

    async handleQuickSearch(args) {
        const { query, max_results = 10 } = args;

        console.error(`[Quick Search] Starting quick search for: "${query}" (max_results=${max_results})`);
        const startTime = Date.now();

        try {
            const result = await this.pubmedClient.search(query, max_results, 0, "relevance");
            const endTime = Date.now();
            console.error(`[Quick Search] Completed in ${endTime - startTime}ms, found ${result.articles.length} articles`);

            if (result.articles.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            total: 0,
                            query: result.query,
                            message: "未找到匹配的文献",
                            articles: []
                        }, null, 2)
                    }]
                };
            }

            const formattedArticles = formatForLLM(result.articles, "llm_optimized", "compact");

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        total: result.total,
                        query: result.query,
                        found: result.articles.length,
                        articles: formattedArticles,
                        search_metadata: {
                            max_results: max_results,
                            response_format: "compact",
                            search_type: "quick"
                        }
                    }, null, 2)
                }]
            };
        } catch (error) {
            const endTime = Date.now();
            console.error(`[Quick Search] Error after ${endTime - startTime}ms:`, error.message);
            throw error;
        }
    }

    async handleCacheInfo(args) {
        const { action = "stats" } = args;

        const getCacheStats = () => {
            const memStats = this.memoryCache.stats;
            const memoryHitRate = memStats.hits / (memStats.hits + memStats.misses) * 100;
            const fileStats = this.fileCache.stats;
            const fileHitRate = fileStats.fileHits / (fileStats.fileHits + fileStats.fileMisses) * 100;
            const fileCacheStats = this.fileCache.getFileStats();

            return {
                memory: {
                    hits: memStats.hits,
                    misses: memStats.misses,
                    sets: memStats.sets,
                    evictions: memStats.evictions,
                    hitRate: memoryHitRate.toFixed(2) + '%',
                    currentSize: this.memoryCache.size,
                    maxSize: this.memoryCache.maxSize,
                    timeoutMinutes: this.memoryCache.timeout / (60 * 1000)
                },
                file: {
                    hits: fileStats.fileHits,
                    misses: fileStats.fileMisses,
                    sets: fileStats.fileSets,
                    hitRate: fileHitRate.toFixed(2) + '%',
                    ...fileCacheStats,
                    expiryDays: PAPER_CACHE_EXPIRY / (24 * 60 * 60 * 1000)
                }
            };
        };

        switch (action) {
            case "stats":
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            cache_stats: getCacheStats(),
                            cache_info: {
                                memory: {
                                    location: "内存 (Node.js进程)",
                                    type: "Map对象",
                                    persistence: "临时 (服务器重启后丢失)",
                                    eviction_policy: "LRU (最近最少使用)"
                                },
                                file: {
                                    location: PAPER_CACHE_DIR,
                                    type: "JSON文件",
                                    persistence: "持久化 (服务器重启后保留)",
                                    expiry_policy: `${PAPER_CACHE_EXPIRY / (24 * 60 * 60 * 1000)}天自动过期`
                                }
                            }
                        }, null, 2)
                    }]
                };

            case "clear": {
                const beforeSize = this.memoryCache.clear();
                console.error(`[Cache] Cleared all ${beforeSize} memory entries`);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: `已清空内存缓存，删除了 ${beforeSize} 个条目`,
                            cache_stats: getCacheStats()
                        }, null, 2)
                    }]
                };
            }

            case "clean": {
                const cleaned = this.memoryCache.cleanExpired();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: `已清理过期内存缓存，删除了 ${cleaned} 个条目`,
                            cache_stats: getCacheStats()
                        }, null, 2)
                    }]
                };
            }

            case "clean_files": {
                const cleanedFiles = this.fileCache.cleanExpired();
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: `已清理过期文件缓存，删除了 ${cleanedFiles} 个文件`,
                            cache_stats: getCacheStats()
                        }, null, 2)
                    }]
                };
            }

            case "clear_files": {
                let deletedCount = 0;
                if (fs.existsSync(PAPER_CACHE_DIR)) {
                    const files = fs.readdirSync(PAPER_CACHE_DIR);
                    for (const file of files) {
                        if (file.endsWith('.json')) {
                            fs.unlinkSync(path.join(PAPER_CACHE_DIR, file));
                            deletedCount++;
                        }
                    }
                }

                const indexPath = path.join(CACHE_DIR, 'index.json');
                const indexData = {
                    version: CACHE_VERSION,
                    created: new Date().toISOString(),
                    papers: {},
                    stats: {
                        totalPapers: 0,
                        lastCleanup: new Date().toISOString()
                    }
                };
                fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));

                console.error(`[Cache] Cleared all ${deletedCount} file cache entries`);
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: `已清空文件缓存，删除了 ${deletedCount} 个文件`,
                            cache_stats: getCacheStats()
                        }, null, 2)
                    }]
                };
            }

            default:
                throw new Error(`Unknown cache action: ${action}`);
        }
    }

    async handleGetDetails(args) {
        const { pmids, include_full_text = false } = args;
        const pmidList = Array.isArray(pmids) ? pmids : [pmids];

        if (pmidList.length > 20) {
            throw new Error("一次最多查询20个PMID，请使用批量查询工具");
        }

        const articles = await this.pubmedClient.fetchArticleDetails(pmidList);

        if (include_full_text) {
            for (let article of articles) {
                try {
                    article.fullAbstract = await this.pubmedClient.fetchFullAbstract(article.pmid);
                } catch (error) {
                    console.warn(`Failed to fetch full abstract for ${article.pmid}:`, error.message);
                }
            }
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    articles: articles,
                    metadata: {
                        count: articles.length,
                        include_full_text: include_full_text
                    }
                }, null, 2)
            }]
        };
    }

    async handleExtractKeyInfo(args) {
        const { pmid, extract_sections = ["basic_info", "abstract_summary", "authors"], max_abstract_length = ABSTRACT_MAX_CHARS } = args;

        const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
        if (articles.length === 0) {
            throw new Error(`未找到PMID为 ${pmid} 的文献`);
        }

        const article = articles[0];
        const extracted = {};

        if (extract_sections.includes("basic_info")) {
            extracted.basic_info = {
                pmid: article.pmid,
                title: article.title,
                journal: article.journal,
                publicationDate: article.publicationDate,
                volume: article.volume,
                issue: article.issue,
                pages: article.pages,
                doi: article.doi,
                url: article.url,
                publicationTypes: article.publicationTypes
            };
        }

        if (extract_sections.includes("authors")) {
            extracted.authors = {
                full_list: article.authors,
                first_author: article.authors[0] || null,
                last_author: article.authors[article.authors.length - 1] || null,
                author_count: article.authors.length
            };
        }

        if (extract_sections.includes("abstract_summary") && article.abstract) {
            const truncatedAbstract = truncateText(article.abstract, max_abstract_length);
            extracted.abstract_summary = {
                full: truncatedAbstract,
                structured: extractAbstractSections(truncatedAbstract),
                key_points: extractKeyPoints(truncatedAbstract),
                word_count: truncatedAbstract.split(/\s+/).length
            };
        }

        if (extract_sections.includes("keywords")) {
            extracted.keywords = {
                mesh_terms: article.meshTerms || [],
                keywords: article.keywords || [],
                combined: [...(article.meshTerms || []), ...(article.keywords || [])].slice(0, 15)
            };
        }

        if (extract_sections.includes("doi_link") && article.doi) {
            extracted.doi_link = {
                doi: article.doi,
                url: article.doi.startsWith('10.') ? `https://doi.org/${article.doi}` : article.url
            };
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    pmid: pmid,
                    extracted_info: extracted,
                    extraction_metadata: {
                        sections: extract_sections,
                        max_abstract_length: max_abstract_length,
                        actual_mode: ABSTRACT_MODE,
                        actual_max_chars: ABSTRACT_MAX_CHARS
                    }
                }, null, 2)
            }]
        };
    }

    async handleCrossReference(args) {
        const { pmid, reference_type = "similar", max_results = 10 } = args;

        let relatedQuery = pmid;
        switch (reference_type) {
            case "similar":
                relatedQuery = `${pmid}[uid]`;
                break;
            case "reviews":
                relatedQuery = `${pmid}[uid] AND review[publication type]`;
                break;
            default:
                relatedQuery = `${pmid}[uid]`;
        }

        const result = await this.pubmedClient.search(relatedQuery, max_results, 0, "relevance");

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    base_pmid: pmid,
                    reference_type: reference_type,
                    related_articles: formatForLLM(result.articles, "llm_optimized"),
                    metadata: {
                        found: result.articles.length,
                        max_results: max_results
                    }
                }, null, 2)
            }]
        };
    }

    async handleBatchQuery(args) {
        const { pmids, query_format = "llm_optimized", include_abstracts = true } = args;

        if (pmids.length > 20) {
            throw new Error("批量查询最多支持20个PMID");
        }

        const articles = await this.pubmedClient.fetchArticleDetails(pmids);

        let formattedArticles;
        switch (query_format) {
            case "concise":
                formattedArticles = articles.map(article => ({
                    pmid: article.pmid,
                    title: article.title,
                    authors: article.authors.slice(0, 3).join(', ') + (article.authors.length > 3 ? ' et al.' : ''),
                    journal: article.journal,
                    date: article.publicationDate,
                    url: article.url
                }));
                break;
            case "detailed":
                formattedArticles = articles;
                break;
            case "llm_optimized":
            default:
                formattedArticles = formatForLLM(articles, "llm_optimized");
                break;
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    query_format: query_format,
                    articles: formattedArticles,
                    metadata: {
                        total_queried: pmids.length,
                        found: articles.length,
                        include_abstracts: include_abstracts
                    }
                }, null, 2)
            }]
        };
    }

    async handleDetectFulltext(args) {
        const { pmid, auto_download = false } = args;

        if (!FULLTEXT_ENABLED) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Full-text mode is not enabled. Set FULLTEXT_MODE=enabled in environment variables.",
                        fulltext_mode: FULLTEXT_MODE
                    }, null, 2)
                }]
            };
        }

        try {
            const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
            if (articles.length === 0) {
                throw new Error(`未找到PMID为 ${pmid} 的文献`);
            }

            const article = articles[0];
            const oaInfo = await this.fulltextService.detectOpenAccess(article);

            let downloadResult = null;
            if (oaInfo.isOpenAccess && (auto_download || FULLTEXT_AUTO_DOWNLOAD)) {
                const cached = this.fulltextService.isPDFCached(pmid);
                if (!cached.cached) {
                    downloadResult = await this.fulltextService.downloadPDF(pmid, oaInfo.downloadUrl, oaInfo);
                } else {
                    downloadResult = {
                        success: true,
                        cached: true,
                        filePath: cached.filePath,
                        fileSize: cached.fileSize
                    };
                }
            }

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        pmid: pmid,
                        article_info: {
                            title: article.title,
                            authors: article.authors.slice(0, 3),
                            journal: article.journal,
                            doi: article.doi
                        },
                        open_access: {
                            is_available: oaInfo.isOpenAccess,
                            sources: oaInfo.sources,
                            download_url: oaInfo.downloadUrl,
                            pmcid: oaInfo.pmcid
                        },
                        download_result: downloadResult,
                        fulltext_mode: {
                            enabled: FULLTEXT_ENABLED,
                            auto_download: FULLTEXT_AUTO_DOWNLOAD,
                            requested_auto_download: auto_download
                        }
                    }, null, 2)
                }]
            };

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error.message,
                        pmid: pmid
                    }, null, 2)
                }]
            };
        }
    }

    async handleDownloadFulltext(args) {
        const { pmid, force_download = false } = args;

        if (!FULLTEXT_ENABLED) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Full-text mode is not enabled. Set FULLTEXT_MODE=enabled in environment variables.",
                        fulltext_mode: FULLTEXT_MODE
                    }, null, 2)
                }]
            };
        }

        try {
            if (!force_download) {
                const cached = this.fulltextService.isPDFCached(pmid);
                if (cached.cached) {
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                pmid: pmid,
                                status: "already_cached",
                                file_path: cached.filePath,
                                file_size: cached.fileSize,
                                age_hours: Math.round(cached.age / (1000 * 60 * 60))
                            }, null, 2)
                        }]
                    };
                }
            }

            const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
            if (articles.length === 0) {
                throw new Error(`未找到PMID为 ${pmid} 的文献`);
            }

            const article = articles[0];
            const oaInfo = await this.fulltextService.detectOpenAccess(article);

            if (!oaInfo.isOpenAccess) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: false,
                            pmid: pmid,
                            error: "No open access full-text available",
                            open_access_sources: oaInfo.sources,
                            suggestion: "Try checking PMC, Unpaywall, or publisher websites manually"
                        }, null, 2)
                    }]
                };
            }

            const downloadResult = await this.fulltextService.smartDownloadPDF(pmid, oaInfo.downloadUrl, oaInfo);

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: downloadResult.success,
                        pmid: pmid,
                        download_result: downloadResult,
                        open_access_info: {
                            sources: oaInfo.sources,
                            download_url: oaInfo.downloadUrl,
                            pmcid: oaInfo.pmcid
                        }
                    }, null, 2)
                }]
            };

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error.message,
                        pmid: pmid
                    }, null, 2)
                }]
            };
        }
    }

    async handleFulltextStatus(args) {
        const { action = "stats", pmid } = args;

        if (!FULLTEXT_ENABLED) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Full-text mode is not enabled",
                        fulltext_mode: FULLTEXT_MODE
                    }, null, 2)
                }]
            };
        }

        try {
            switch (action) {
                case "stats": {
                    const statsIndexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    let stats = {
                        fulltext_mode: FULLTEXT_MODE,
                        enabled: FULLTEXT_ENABLED,
                        auto_download: FULLTEXT_AUTO_DOWNLOAD,
                        cache_directory: FULLTEXT_CACHE_DIR,
                        total_pdfs: 0,
                        total_size: 0,
                        last_cleanup: null
                    };

                    if (fs.existsSync(statsIndexPath)) {
                        const statsIndexData = JSON.parse(fs.readFileSync(statsIndexPath, 'utf8'));
                        stats = {
                            ...stats,
                            total_pdfs: statsIndexData.stats.totalPDFs,
                            total_size: statsIndexData.stats.totalSize,
                            last_cleanup: statsIndexData.stats.lastCleanup,
                            cache_version: statsIndexData.version
                        };
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "stats", stats: stats }, null, 2)
                        }]
                    };
                }

                case "list": {
                    const listPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    if (!fs.existsSync(listPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({ success: true, action: "list", papers: [], message: "No full-text papers cached" }, null, 2)
                            }]
                        };
                    }

                    const listIndexData = JSON.parse(fs.readFileSync(listPath, 'utf8'));
                    const papers = pmid ?
                        (listIndexData.fulltext_papers[pmid] ? [listIndexData.fulltext_papers[pmid]] : []) :
                        Object.values(listIndexData.fulltext_papers);

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "list", papers: papers, total: papers.length }, null, 2)
                        }]
                    };
                }

                case "clean": {
                    let cleaned = 0;
                    const cleanPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    if (fs.existsSync(cleanPath)) {
                        const cleanIndexData = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));
                        const now = Date.now();

                        for (const [pmid, info] of Object.entries(cleanIndexData.fulltext_papers)) {
                            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
                            if (fs.existsSync(pdfPath)) {
                                const stats = fs.statSync(pdfPath);
                                const age = now - stats.mtime.getTime();
                                if (age > PDF_CACHE_EXPIRY) {
                                    fs.unlinkSync(pdfPath);
                                    delete cleanIndexData.fulltext_papers[pmid];
                                    cleaned++;
                                }
                            }
                        }

                        if (cleaned > 0) {
                            cleanIndexData.stats.totalPDFs = Object.keys(cleanIndexData.fulltext_papers).length;
                            cleanIndexData.stats.totalSize = Object.values(cleanIndexData.fulltext_papers)
                                .reduce((sum, paper) => sum + (paper.fileSize || 0), 0);
                            cleanIndexData.stats.lastCleanup = new Date().toISOString();
                            fs.writeFileSync(cleanPath, JSON.stringify(cleanIndexData, null, 2));
                        }
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "clean", cleaned_files: cleaned, message: `Cleaned ${cleaned} expired PDF files` }, null, 2)
                        }]
                    };
                }

                case "clear": {
                    let deleted = 0;
                    if (fs.existsSync(FULLTEXT_CACHE_DIR)) {
                        const files = fs.readdirSync(FULLTEXT_CACHE_DIR);
                        for (const file of files) {
                            if (file.endsWith('.pdf')) {
                                fs.unlinkSync(path.join(FULLTEXT_CACHE_DIR, file));
                                deleted++;
                            }
                        }
                    }

                    const clearIndexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    const clearIndexData = {
                        version: CACHE_VERSION,
                        created: new Date().toISOString(),
                        fulltext_papers: {},
                        stats: { totalPDFs: 0, totalSize: 0, lastCleanup: new Date().toISOString() }
                    };
                    fs.writeFileSync(clearIndexPath, JSON.stringify(clearIndexData, null, 2));

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "clear", deleted_files: deleted, message: `Cleared all ${deleted} PDF files` }, null, 2)
                        }]
                    };
                }

                default:
                    throw new Error(`Unknown action: ${action}`);
            }

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: error.message, action: action }, null, 2)
                }]
            };
        }
    }

    async handleBatchDownload(args) {
        const { pmids, human_like = true } = args;

        if (!FULLTEXT_ENABLED) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: "Full-text mode is not enabled. Set FULLTEXT_MODE=enabled in environment variables.",
                        fulltext_mode: FULLTEXT_MODE
                    }, null, 2)
                }]
            };
        }

        if (pmids.length > 10) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: "Maximum 10 PMIDs allowed for batch download" }, null, 2)
                }]
            };
        }

        try {
            console.error(`[BatchDownload] Starting batch download for ${pmids.length} papers`);

            const downloadList = [];
            for (const pmid of pmids) {
                const articles = await this.pubmedClient.fetchArticleDetails([pmid]);
                if (articles.length > 0) {
                    const article = articles[0];
                    const oaInfo = await this.fulltextService.detectOpenAccess(article);

                    if (oaInfo.isOpenAccess) {
                        downloadList.push({
                            pmid: pmid,
                            title: article.title,
                            downloadUrl: oaInfo.downloadUrl,
                            oaInfo: oaInfo
                        });
                    }
                }
            }

            if (downloadList.length === 0) {
                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            message: "No open access papers found for download",
                            total_requested: pmids.length,
                            available_for_download: 0
                        }, null, 2)
                    }]
                };
            }

            const results = await this.fulltextService.batchDownloadPDFs(downloadList);

            const successful = results.filter(r => r.result.success);
            const failed = results.filter(r => !r.result.success);

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        batch_download: {
                            total_requested: pmids.length,
                            available_for_download: downloadList.length,
                            successful_downloads: successful.length,
                            failed_downloads: failed.length
                        },
                        results: results,
                        human_like_mode: human_like,
                        system_info: detectSystemEnvironment()
                    }, null, 2)
                }]
            };

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: error.message, pmids: pmids }, null, 2)
                }]
            };
        }
    }

    async handleSystemCheck(args) {
        try {
            const systemInfo = await checkDownloadTools();

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        system_environment: systemInfo,
                        api_key_pool: this.apiKeyPool ? this.apiKeyPool.getStatus() : null,
                        fulltext_mode: {
                            enabled: FULLTEXT_ENABLED,
                            mode: FULLTEXT_MODE,
                            auto_download: FULLTEXT_AUTO_DOWNLOAD
                        },
                        recommendations: getSystemRecommendations(systemInfo)
                    }, null, 2)
                }]
            };

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: error.message }, null, 2)
                }]
            };
        }
    }

    async handleEndNoteStatus(args) {
        const { action = "stats" } = args;

        try {
            switch (action) {
                case "stats": {
                    const status = this.endnoteService.getStatus();
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "stats", endnote_export: status }, null, 2)
                        }]
                    };
                }

                case "list": {
                    const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    if (!fs.existsSync(indexPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({ success: true, action: "list", exported_papers: [], message: "No EndNote exports found" }, null, 2)
                            }]
                        };
                    }

                    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                    const papers = Object.values(indexData.exported_papers);
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "list", exported_papers: papers, total: papers.length }, null, 2)
                        }]
                    };
                }

                case "clean": {
                    let cleaned = 0;
                    const cleanPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    if (fs.existsSync(cleanPath)) {
                        const indexData = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));
                        const now = Date.now();
                        const fileExpiry = 30 * 24 * 60 * 60 * 1000;

                        for (const [pmid, info] of Object.entries(indexData.exported_papers)) {
                            const exportTime = new Date(info.exported).getTime();
                            const age = now - exportTime;

                            if (age > fileExpiry) {
                                const risFile = path.join(ENDNOTE_CACHE_DIR, `${pmid}.ris`);
                                const bibFile = path.join(ENDNOTE_CACHE_DIR, `${pmid}.bib`);

                                if (fs.existsSync(risFile)) fs.unlinkSync(risFile);
                                if (fs.existsSync(bibFile)) fs.unlinkSync(bibFile);

                                delete indexData.exported_papers[pmid];
                                cleaned++;
                            }
                        }

                        if (cleaned > 0) {
                            indexData.stats.totalExports = Object.keys(indexData.exported_papers).length;
                            indexData.stats.lastCleanup = new Date().toISOString();
                            fs.writeFileSync(cleanPath, JSON.stringify(indexData, null, 2));
                        }
                    }

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "clean", message: `Cleaned ${cleaned} expired EndNote export files` }, null, 2)
                        }]
                    };
                }

                case "clear": {
                    let deleted = 0;
                    if (fs.existsSync(ENDNOTE_CACHE_DIR)) {
                        const files = fs.readdirSync(ENDNOTE_CACHE_DIR);
                        for (const file of files) {
                            if (file.endsWith('.ris') || file.endsWith('.bib')) {
                                fs.unlinkSync(path.join(ENDNOTE_CACHE_DIR, file));
                                deleted++;
                            }
                        }
                    }

                    const clearIndexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    const clearIndexData = {
                        version: CACHE_VERSION,
                        created: new Date().toISOString(),
                        exported_papers: {},
                        stats: { totalExports: 0, risFiles: 0, bibtexFiles: 0, lastExport: null }
                    };
                    fs.writeFileSync(clearIndexPath, JSON.stringify(clearIndexData, null, 2));

                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: true, action: "clear", message: `Cleared ${deleted} EndNote export files` }, null, 2)
                        }]
                    };
                }

                default:
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({ success: false, error: `Unknown action: ${action}`, action: action }, null, 2)
                        }]
                    };
            }

        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({ success: false, error: error.message, action: action }, null, 2)
                }]
            };
        }
    }
}
