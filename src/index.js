#!/usr/bin/env node
import 'dotenv/config';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";
import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import os from 'os';
import http from 'http';
import { URL } from 'url';

const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const RATE_LIMIT_DELAY = 334; // PubMed rate limit: 3 requests per second
const REQUEST_TIMEOUT = 30000; // 30秒请求超时

// 缓存配置
const CACHE_DIR = path.join(process.cwd(), 'cache');
const PAPER_CACHE_DIR = path.join(CACHE_DIR, 'papers');
const CACHE_VERSION = '1.0';
const PAPER_CACHE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30天过期

// Abstract truncation modes (env-driven)
const ABSTRACT_MODE = (process.env.ABSTRACT_MODE || 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick';
const ABSTRACT_MAX_CHARS = ABSTRACT_MODE === 'deep' ? 6000 : 1500;
const ABSTRACT_MODE_NOTE = ABSTRACT_MODE === 'deep'
    ? 'Deep mode: up to 6000 chars per abstract. Requires large model context (>=120k tokens recommended for batch usage).'
    : 'Quick mode: up to 1500 chars per abstract (may be incomplete). Optimized for fast retrieval.';

// Full-text mode configuration
const FULLTEXT_MODE = (process.env.FULLTEXT_MODE || 'disabled').toLowerCase();
const FULLTEXT_ENABLED = FULLTEXT_MODE === 'enabled' || FULLTEXT_MODE === 'auto';
const FULLTEXT_AUTO_DOWNLOAD = FULLTEXT_MODE === 'auto';

// Full-text cache configuration
const FULLTEXT_CACHE_DIR = path.join(CACHE_DIR, 'fulltext');
const PDF_CACHE_EXPIRY = 90 * 24 * 60 * 60 * 1000; // 90天过期
const MAX_PDF_SIZE = 50 * 1024 * 1024; // 50MB最大PDF大小

// EndNote导出配置
const ENDNOTE_EXPORT_ENABLED = (process.env.ENDNOTE_EXPORT || 'enabled').toLowerCase() === 'enabled';
const ENDNOTE_CACHE_DIR = path.join(CACHE_DIR, 'endnote');
const ENDNOTE_EXPORT_FORMATS = ['ris', 'bibtex']; // 支持的导出格式

// OA detection URLs
const PMC_BASE_URL = 'https://www.ncbi.nlm.nih.gov/pmc';
const PMC_API_URL = 'https://www.ncbi.nlm.nih.gov/pmc/oai/oai.cgi';
const UNPAYWALL_API_URL = 'https://api.unpaywall.org/v2';

// 传输模式配置
const parseMode = () => {
    const args = process.argv.slice(2);
    const modeArg = args.find(arg => arg.startsWith('--mode='));
    if (modeArg) {
        return modeArg.split('=')[1];
    }
    // 支持环境变量作为备选
    return process.env.MCP_TRANSPORT || 'stdio';
};

const MODE = parseMode();
const PORT = parseInt(process.env.PORT || '3000', 10);

class PubMedDataServer {
    constructor() {
        this.server = new Server(
            {
                name: "pubmed-data-server",
                version: "2.0.0",
            },
            {
                capabilities: {
                    tools: {},
                },
            }
        );

        this.setupRequestHandlers();
        this.lastRequestTime = 0;
        this.cache = new Map(); // 简单的内存缓存
        this.cacheTimeout = 5 * 60 * 1000; // 5分钟缓存过期
        this.maxCacheSize = 100; // 最大缓存条目数
        this.cacheStats = {
            hits: 0,
            misses: 0,
            sets: 0,
            evictions: 0,
            fileHits: 0,
            fileMisses: 0,
            fileSets: 0
        };
        
        // 初始化缓存目录
        this.initCacheDirectories();
        
        // 初始化全文模式
        if (FULLTEXT_ENABLED) {
            this.initFullTextMode();
        }
        
        // 初始化EndNote导出模式
        if (ENDNOTE_EXPORT_ENABLED) {
            this.initEndNoteExport();
        }
    }

    // 初始化缓存目录
    initCacheDirectories() {
        try {
            if (!fs.existsSync(CACHE_DIR)) {
                fs.mkdirSync(CACHE_DIR, { recursive: true });
                console.error(`[Cache] Created cache directory: ${CACHE_DIR}`);
            }
            
            if (!fs.existsSync(PAPER_CACHE_DIR)) {
                fs.mkdirSync(PAPER_CACHE_DIR, { recursive: true });
                console.error(`[Cache] Created paper cache directory: ${PAPER_CACHE_DIR}`);
            }
            
            // 创建缓存索引文件
            const indexPath = path.join(CACHE_DIR, 'index.json');
            if (!fs.existsSync(indexPath)) {
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
                console.error(`[Cache] Created cache index: ${indexPath}`);
            }
        } catch (error) {
            console.error(`[Cache] Error initializing cache directories:`, error.message);
        }
    }

    // 初始化全文模式
    initFullTextMode() {
        try {
            if (!fs.existsSync(FULLTEXT_CACHE_DIR)) {
                fs.mkdirSync(FULLTEXT_CACHE_DIR, { recursive: true });
                console.error(`[FullText] Created fulltext cache directory: ${FULLTEXT_CACHE_DIR}`);
            }
            
            // 创建全文索引文件
            const fulltextIndexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
            if (!fs.existsSync(fulltextIndexPath)) {
                const indexData = {
                    version: CACHE_VERSION,
                    created: new Date().toISOString(),
                    fulltext_papers: {},
                    stats: {
                        totalPDFs: 0,
                        totalSize: 0,
                        lastCleanup: new Date().toISOString()
                    }
                };
                fs.writeFileSync(fulltextIndexPath, JSON.stringify(indexData, null, 2));
                console.error(`[FullText] Created fulltext index: ${fulltextIndexPath}`);
            }
            
            console.error(`[FullText] Full-text mode initialized (mode: ${FULLTEXT_MODE})`);
        } catch (error) {
            console.error(`[FullText] Error initializing full-text mode:`, error.message);
        }
    }

    // 论文文件缓存管理
    getPaperCachePath(pmid) {
        return path.join(PAPER_CACHE_DIR, `${pmid}.json`);
    }

    getPaperFromFileCache(pmid) {
        try {
            const cachePath = this.getPaperCachePath(pmid);
            if (!fs.existsSync(cachePath)) {
                this.cacheStats.fileMisses++;
                return null;
            }

            const fileContent = fs.readFileSync(cachePath, 'utf8');
            const cachedData = JSON.parse(fileContent);
            
            // 检查过期时间
            if (Date.now() - cachedData.timestamp > PAPER_CACHE_EXPIRY) {
                fs.unlinkSync(cachePath); // 删除过期文件
                this.cacheStats.fileMisses++;
                console.error(`[Cache] Expired paper cache deleted: ${pmid}`);
                return null;
            }

            this.cacheStats.fileHits++;
            console.error(`[Cache] File cache hit for PMID: ${pmid}`);
            return cachedData.data;
        } catch (error) {
            console.error(`[Cache] Error reading paper cache for ${pmid}:`, error.message);
            this.cacheStats.fileMisses++;
            return null;
        }
    }

    setPaperToFileCache(pmid, data) {
        try {
            const cachePath = this.getPaperCachePath(pmid);
            const cacheData = {
                version: CACHE_VERSION,
                pmid: pmid,
                timestamp: Date.now(),
                data: data
            };
            
            fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
            this.cacheStats.fileSets++;
            console.error(`[Cache] Paper cached to file: ${pmid}`);
            
            // 更新索引
            this.updateCacheIndex(pmid, true);
        } catch (error) {
            console.error(`[Cache] Error writing paper cache for ${pmid}:`, error.message);
        }
    }

    // 更新缓存索引
    updateCacheIndex(pmid, added = true) {
        try {
            const indexPath = path.join(CACHE_DIR, 'index.json');
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            
            if (added) {
                indexData.papers[pmid] = {
                    cached: new Date().toISOString(),
                    file: `${pmid}.json`
                };
                indexData.stats.totalPapers = Object.keys(indexData.papers).length;
            } else {
                delete indexData.papers[pmid];
                indexData.stats.totalPapers = Object.keys(indexData.papers).length;
            }
            
            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
        } catch (error) {
            console.error(`[Cache] Error updating cache index:`, error.message);
        }
    }

    // 清理过期的论文缓存文件
    cleanExpiredPaperCache() {
        try {
            const indexPath = path.join(CACHE_DIR, 'index.json');
            if (!fs.existsSync(indexPath)) return 0;
            
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            let cleaned = 0;
            
            for (const [pmid, info] of Object.entries(indexData.papers)) {
                const cachePath = this.getPaperCachePath(pmid);
                if (fs.existsSync(cachePath)) {
                    const fileContent = fs.readFileSync(cachePath, 'utf8');
                    const cachedData = JSON.parse(fileContent);
                    
                    if (Date.now() - cachedData.timestamp > PAPER_CACHE_EXPIRY) {
                        fs.unlinkSync(cachePath);
                        delete indexData.papers[pmid];
                        cleaned++;
                    }
                } else {
                    // 文件不存在，从索引中删除
                    delete indexData.papers[pmid];
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                indexData.stats.totalPapers = Object.keys(indexData.papers).length;
                indexData.stats.lastCleanup = new Date().toISOString();
                fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
                console.error(`[Cache] Cleaned ${cleaned} expired paper cache files`);
            }
            
            return cleaned;
        } catch (error) {
            console.error(`[Cache] Error cleaning expired paper cache:`, error.message);
            return 0;
        }
    }

    setupRequestHandlers(server = null) {
        const targetServer = server || this.server;
        // 列出可用工具
        targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "pubmed_search",
                        description: "搜索PubMed文献并返回结构化数据，供LLM进一步分析",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "搜索查询，支持布尔逻辑和MeSH术语"
                                },
                                max_results: {
                                    type: "number",
                                    description: "最大返回结果数量 (1-100)",
                                    default: 20,
                                    minimum: 1,
                                    maximum: 100
                                },
                                page_size: {
                                    type: "number",
                                    description: "分页大小，用于控制单次返回的文章数量",
                                    default: 20,
                                    minimum: 5,
                                    maximum: 50
                                },
                                days_back: {
                                    type: "number",
                                    description: "搜索最近N天的文献，0表示不限制",
                                    default: 0,
                                    minimum: 0
                                },
                                include_abstract: {
                                    type: "boolean",
                                    description: "是否包含摘要内容",
                                    default: true
                                },
                                sort_by: {
                                    type: "string",
                                    description: "排序方式: relevance, date, pubdate",
                                    default: "relevance",
                                    enum: ["relevance", "date", "pubdate"]
                                },
                                response_format: {
                                    type: "string",
                                    description: "响应格式: compact, standard, detailed",
                                    default: "standard",
                                    enum: ["compact", "standard", "detailed"]
                                }
                            },
                            required: ["query"]
                        }
                    },
                    {
                        name: "pubmed_quick_search",
                        description: "快速搜索PubMed文献，返回精简结果，优化响应速度",
                        inputSchema: {
                            type: "object",
                            properties: {
                                query: {
                                    type: "string",
                                    description: "搜索查询"
                                },
                                max_results: {
                                    type: "number",
                                    description: "最大返回结果数量 (1-20)",
                                    default: 10,
                                    minimum: 1,
                                    maximum: 20
                                }
                            },
                            required: ["query"]
                        }
                    },
                    {
                        name: "pubmed_cache_info",
                        description: "获取缓存统计信息和状态，支持内存和文件缓存管理",
                        inputSchema: {
                            type: "object",
                            properties: {
                                action: {
                                    type: "string",
                                    description: "缓存操作",
                                    enum: ["stats", "clear", "clean", "clean_files", "clear_files"],
                                    default: "stats"
                                }
                            }
                        }
                    },
                    {
                        name: "pubmed_get_details",
                        description: "获取指定PMID的完整文献信息，包括全文摘要和详细元数据",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmids: {
                                    oneOf: [
                                        { type: "string" },
                                        {
                                            type: "array",
                                            items: { type: "string" }
                                        }
                                    ],
                                    description: "PMID或PMID列表"
                                },
                                include_full_text: {
                                    type: "boolean",
                                    description: "尝试获取全文链接",
                                    default: false
                                }
                            },
                            required: ["pmids"]
                        }
                    },
                    {
                        name: "pubmed_extract_key_info",
                        description: "提取文献关键信息，优化LLM理解和处理",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmid: {
                                    type: "string",
                                    description: "PubMed文献ID"
                                },
                                extract_sections: {
                                    type: "array",
                                    description: "要提取的信息部分",
                                    items: {
                                        type: "string",
                                        enum: [
                                            "basic_info",        // 基本信息
                                            "authors",           // 作者信息
                                            "abstract_summary",  // 摘要总结
                                            "keywords",          // 关键词
                                            "methods",           // 方法部分
                                            "results",           // 结果部分
                                            "conclusions",       // 结论部分
                                            "references",        // 参考文献
                                            "doi_link"          // DOI链接
                                        ]
                                    },
                                    default: ["basic_info", "abstract_summary", "authors"]
                                },
                                max_abstract_length: {
                                    type: "number",
                                    description: "摘要最大长度（字符）",
                                    default: 5000,
                                    minimum: 500,
                                    maximum: 6000
                                }
                            },
                            required: ["pmid"]
                        }
                    },
                    {
                        name: "pubmed_cross_reference",
                        description: "交叉引用相关文献，用于事实核查和深度分析",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmid: {
                                    type: "string",
                                    description: "基础文献PMID"
                                },
                                reference_type: {
                                    type: "string",
                                    description: "引用类型",
                                    enum: [
                                        "citing",      // 引用本文的文献
                                        "cited",       // 本文引用的文献
                                        "similar",     // 相似文献
                                        "reviews"      // 相关综述
                                    ],
                                    default: "similar"
                                },
                                max_results: {
                                    type: "number",
                                    description: "最大结果数",
                                    default: 10,
                                    minimum: 1,
                                    maximum: 50
                                }
                            },
                            required: ["pmid"]
                        }
                    },
                    {
                        name: "pubmed_batch_query",
                        description: "批量查询多个PMID的详细信息，优化上下文窗口使用",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "PMID列表 (最多20个)",
                                    maxItems: 20
                                },
                                query_format: {
                                    type: "string",
                                    description: "输出格式优化",
                                    enum: [
                                        "concise",     // 简洁格式
                                        "detailed",    // 详细格式
                                        "llm_optimized" // LLM优化格式
                                    ],
                                    default: "llm_optimized"
                                },
                                include_abstracts: {
                                    type: "boolean",
                                    description: "是否包含摘要",
                                    default: true
                                }
                            },
                            required: ["pmids"]
                        }
                    },
                    {
                        name: "pubmed_detect_fulltext",
                        description: "检测文献的开放获取状态和全文可用性",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmid: {
                                    type: "string",
                                    description: "PubMed文献ID"
                                },
                                auto_download: {
                                    type: "boolean",
                                    description: "是否自动下载可用的全文",
                                    default: false
                                }
                            },
                            required: ["pmid"]
                        }
                    },
                    {
                        name: "pubmed_download_fulltext",
                        description: "下载指定文献的全文PDF（如果可用）",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmid: {
                                    type: "string",
                                    description: "PubMed文献ID"
                                },
                                force_download: {
                                    type: "boolean",
                                    description: "是否强制重新下载（即使已缓存）",
                                    default: false
                                }
                            },
                            required: ["pmid"]
                        }
                    },
                    {
                        name: "pubmed_fulltext_status",
                        description: "获取全文缓存状态和统计信息",
                        inputSchema: {
                            type: "object",
                            properties: {
                                action: {
                                    type: "string",
                                    description: "操作类型",
                                    enum: ["stats", "list", "clean", "clear"],
                                    default: "stats"
                                },
                                pmid: {
                                    type: "string",
                                    description: "指定PMID（仅用于list操作）"
                                }
                            }
                        }
                    },
                    {
                        name: "pubmed_batch_download",
                        description: "批量下载多个文献的全文PDF，支持跨平台智能下载",
                        inputSchema: {
                            type: "object",
                            properties: {
                                pmids: {
                                    type: "array",
                                    items: { type: "string" },
                                    description: "PMID列表 (最多10个)",
                                    maxItems: 10
                                },
                                human_like: {
                                    type: "boolean",
                                    description: "是否使用类人操作模式（随机延迟）",
                                    default: true
                                }
                            },
                            required: ["pmids"]
                        }
                    },
                    {
                        name: "pubmed_system_check",
                        description: "检查系统环境和下载工具可用性",
                        inputSchema: {
                            type: "object",
                            properties: {}
                        }
                    },
                    {
                        name: "pubmed_endnote_status",
                        description: "获取EndNote导出状态和统计信息",
                        inputSchema: {
                            type: "object",
                            properties: {
                                action: {
                                    type: "string",
                                    description: "操作类型",
                                    enum: ["stats", "list", "clean", "clear"],
                                    default: "stats"
                                }
                            }
                        }
                    }
                ]
            };
        });

        // 处理工具调用
        targetServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
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
            } catch (error) {
                console.error(`Error handling ${name}:`, error);
                return {
                    content: [
                        {
                            type: "text",
                            text: `Error: ${error.message}`
                        }
                    ]
                };
            }
        });
    }

    async enforceRateLimit() {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < RATE_LIMIT_DELAY) {
            await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }

    // 缓存管理
    getCacheKey(query, maxResults, daysBack, sortBy) {
        return `${query}|${maxResults}|${daysBack}|${sortBy}`;
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            this.cacheStats.hits++;
            console.error(`[Cache] Hit for key: ${key.substring(0, 50)}... (hits: ${this.cacheStats.hits})`);
            return cached.data;
        }
        if (cached) {
            this.cache.delete(key);
        }
        this.cacheStats.misses++;
        return null;
    }

    setCache(key, data) {
        // 检查缓存大小限制
        if (this.cache.size >= this.maxCacheSize) {
            // LRU淘汰：删除最旧的条目
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
            this.cacheStats.evictions++;
            console.error(`[Cache] Evicted oldest entry: ${oldestKey.substring(0, 30)}...`);
        }
        
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        this.cacheStats.sets++;
        console.error(`[Cache] Set for key: ${key.substring(0, 50)}... (size: ${this.cache.size}/${this.maxCacheSize})`);
    }

    // 缓存统计信息
    getCacheStats() {
        const memoryHitRate = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100;
        const fileHitRate = this.cacheStats.fileHits / (this.cacheStats.fileHits + this.cacheStats.fileMisses) * 100;
        
        // 获取文件缓存统计
        let fileCacheStats = { totalPapers: 0, cacheDir: PAPER_CACHE_DIR };
        try {
            const indexPath = path.join(CACHE_DIR, 'index.json');
            if (fs.existsSync(indexPath)) {
                const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                fileCacheStats = {
                    totalPapers: indexData.stats.totalPapers,
                    cacheDir: PAPER_CACHE_DIR,
                    lastCleanup: indexData.stats.lastCleanup,
                    version: indexData.version
                };
            }
        } catch (error) {
            console.error(`[Cache] Error reading file cache stats:`, error.message);
        }
        
        return {
            memory: {
                hits: this.cacheStats.hits,
                misses: this.cacheStats.misses,
                sets: this.cacheStats.sets,
                evictions: this.cacheStats.evictions,
                hitRate: memoryHitRate.toFixed(2) + '%',
                currentSize: this.cache.size,
                maxSize: this.maxCacheSize,
                timeoutMinutes: this.cacheTimeout / (60 * 1000)
            },
            file: {
                hits: this.cacheStats.fileHits,
                misses: this.cacheStats.fileMisses,
                sets: this.cacheStats.fileSets,
                hitRate: fileHitRate.toFixed(2) + '%',
                ...fileCacheStats,
                expiryDays: PAPER_CACHE_EXPIRY / (24 * 60 * 60 * 1000)
            }
        };
    }

    // 清理过期缓存
    cleanExpiredCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp >= this.cacheTimeout) {
                this.cache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            console.error(`[Cache] Cleaned ${cleaned} expired entries`);
        }
        return cleaned;
    }

    async searchPubMed(query, maxResults = 20, daysBack = 0, sortBy = "relevance") {
        // 检查缓存
        const cacheKey = this.getCacheKey(query, maxResults, daysBack, sortBy);
        const cachedResult = this.getFromCache(cacheKey);
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
        this.setCache(cacheKey, result);
        
        return result;
    }

    async fetchArticleDetails(ids) {
        const articles = [];
        const uncachedIds = [];
        
        // 首先检查文件缓存
        for (const id of ids) {
            const cachedArticle = this.getPaperFromFileCache(id);
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
                this.setPaperToFileCache(article.pmid, article);
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
                abstract: article.abstract || null, // esummary 可能有截断的摘要
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
                    // 只有当 esummary 没有摘要或摘要很短时才获取完整摘要
                    if (!article.abstract || article.abstract.length < 1000) {
                        article.abstract = await this.fetchFullAbstract(article.pmid);
                    }
                } catch (error) {
                    console.warn(`Failed to fetch full abstract for ${article.pmid}:`, error.message);
                    // 保留原有的摘要（即使可能不完整）
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

    // 格式化文献信息为LLM友好格式
    formatForLLM(articles, format = "llm_optimized", responseFormat = "standard") {
        if (format === "concise") {
            return articles.map(article => ({
                pmid: article.pmid,
                title: article.title,
                authors: article.authors.slice(0, 3).join(', ') + (article.authors.length > 3 ? ' et al.' : ''),
                journal: article.journal,
                date: article.publicationDate,
                url: article.url
            }));
        }

        if (format === "detailed") {
            return articles.map(article => ({
                ...article,
                structuredAbstract: article.abstract ? this.extractAbstractSections(article.abstract) : null
            }));
        }

        // 根据响应格式选择不同的优化策略
        if (responseFormat === "compact") {
            return articles.map(article => ({
                pmid: article.pmid,
                title: article.title,
                authors: article.authors.slice(0, 2).join(', ') + (article.authors.length > 2 ? ' et al.' : ''),
                journal: article.journal,
                date: article.publicationDate,
                url: article.url,
                abstract: article.abstract ? this.truncateText(article.abstract, 500) : null
            }));
        }

        if (responseFormat === "detailed") {
            return articles.map(article => {
                const structured = {
                    identifier: `PMID: ${article.pmid}`,
                    title: article.title,
                    citation: `${article.authors.slice(0, 3).join(', ')}${article.authors.length > 3 ? ' et al.' : ''} ${article.journal}, ${article.publicationDate}`,
                    url: article.url,
                    volume: article.volume,
                    issue: article.issue,
                    pages: article.pages,
                    doi: article.doi
                };

                if (article.abstract) {
                    structured.abstract = this.truncateText(article.abstract, ABSTRACT_MAX_CHARS);
                    structured.key_points = this.extractKeyPoints(article.abstract);
                    structured.structured_sections = this.extractAbstractSections(article.abstract);
                }

                if (article.meshTerms && article.meshTerms.length > 0) {
                    structured.keywords = article.meshTerms.slice(0, 15);
                }

                return structured;
            });
        }

        // 标准格式 (默认)
        return articles.map(article => {
            const structured = {
                pmid: article.pmid,
                title: article.title,
                citation: `${article.authors.slice(0, 3).join(', ')}${article.authors.length > 3 ? ' et al.' : ''} ${article.journal}, ${article.publicationDate}`,
                url: article.url
            };

            if (article.abstract) {
                structured.abstract = this.truncateText(article.abstract, ABSTRACT_MAX_CHARS);
                structured.key_points = this.extractKeyPoints(article.abstract);
            }

            if (article.meshTerms && article.meshTerms.length > 0) {
                structured.keywords = article.meshTerms.slice(0, 8);
            }

            return structured;
        });
    }

    extractAbstractSections(abstract) {
        // 尝试提取摘要的结构化部分
        const sections = {};

        const sectionPatterns = [
            { name: "background", regex: /(?:BACKGROUND|BACKGROUND:|Introduction)/i },
            { name: "methods", regex: /(?:METHODS|METHODS:|Methodology)/i },
            { name: "results", regex: /(?:RESULTS|RESULTS:|Findings)/i },
            { name: "conclusions", regex: /(?:CONCLUSIONS|CONCLUSIONS:|Conclusion)/i }
        ];

        sectionPatterns.forEach(section => {
            const match = abstract.match(new RegExp(`${section.regex}(.+?)(?=${sectionPatterns.map(s => s.regex).join('|')}|$)`, 'is'));
            if (match) {
                sections[section.name] = match[1].trim();
            }
        });

        return Object.keys(sections).length > 0 ? sections : { full: abstract };
    }

    extractKeyPoints(abstract) {
        // 提取关键点（简单实现，可以进一步优化）
        const sentences = abstract.split(/[.!?]+/).filter(s => s.trim().length > 20);
        return sentences.slice(0, 5).map(s => s.trim());
    }

    truncateText(text, maxLength) {
        if (text.length <= maxLength) return text;
        return text.substring(0, maxLength - 3) + "...";
    }

    // 工具处理方法
    async handleSearch(args) {
        const { query, max_results = 20, page_size = 20, days_back = 0, include_abstract = true, sort_by = "relevance", response_format = "standard" } = args;
        
        // 智能调整结果数量
        const effectiveMaxResults = Math.min(max_results, page_size);
        const isLargeQuery = max_results > 50;
        
        console.error(`[PubMed Search] Starting search for: "${query}" (max_results=${max_results}, page_size=${page_size}, effective=${effectiveMaxResults})`);
        const startTime = Date.now();

        try {
            const result = await this.searchPubMed(query, effectiveMaxResults, days_back, sort_by);
            const endTime = Date.now();
            console.error(`[PubMed Search] Completed in ${endTime - startTime}ms, found ${result.articles.length} articles`);

            if (result.articles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                total: 0,
                                query: result.query,
                                message: "未找到匹配的文献",
                                articles: []
                            }, null, 2)
                        }
                    ]
                };
            }

            // 格式化为LLM友好的输出
            const formattedArticles = this.formatForLLM(result.articles, "llm_optimized", response_format);
            
            // 自动导出到EndNote格式
            let endnoteExport = null;
            if (ENDNOTE_EXPORT_ENABLED && result.articles.length > 0) {
                try {
                    endnoteExport = await this.autoExportToEndNote(result.articles);
                    console.error(`[EndNote] Auto-exported ${endnoteExport.exported} papers to EndNote formats`);
                } catch (error) {
                    console.error(`[EndNote] Auto-export failed:`, error.message);
                }
            }

            return {
                content: [
                    {
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
                    }
                ]
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
            const result = await this.searchPubMed(query, max_results, 0, "relevance");
            const endTime = Date.now();
            console.error(`[Quick Search] Completed in ${endTime - startTime}ms, found ${result.articles.length} articles`);

            if (result.articles.length === 0) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                total: 0,
                                query: result.query,
                                message: "未找到匹配的文献",
                                articles: []
                            }, null, 2)
                        }
                    ]
                };
            }

            // 使用最精简的格式
            const formattedArticles = this.formatForLLM(result.articles, "llm_optimized", "compact");

            return {
                content: [
                    {
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
                    }
                ]
            };
        } catch (error) {
            const endTime = Date.now();
            console.error(`[Quick Search] Error after ${endTime - startTime}ms:`, error.message);
            throw error;
        }
    }

    async handleCacheInfo(args) {
        const { action = "stats" } = args;
        
        switch (action) {
            case "stats":
                const stats = this.getCacheStats();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                cache_stats: stats,
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
                        }
                    ]
                };
                
            case "clear":
                const beforeSize = this.cache.size;
                this.cache.clear();
                this.cacheStats = { hits: 0, misses: 0, sets: 0, evictions: 0, fileHits: 0, fileMisses: 0, fileSets: 0 };
                console.error(`[Cache] Cleared all ${beforeSize} memory entries`);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message: `已清空内存缓存，删除了 ${beforeSize} 个条目`,
                                cache_stats: this.getCacheStats()
                            }, null, 2)
                        }
                    ]
                };
                
            case "clean":
                const cleaned = this.cleanExpiredCache();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message: `已清理过期内存缓存，删除了 ${cleaned} 个条目`,
                                cache_stats: this.getCacheStats()
                            }, null, 2)
                        }
                    ]
                };
                
            case "clean_files":
                const cleanedFiles = this.cleanExpiredPaperCache();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                message: `已清理过期文件缓存，删除了 ${cleanedFiles} 个文件`,
                                cache_stats: this.getCacheStats()
                            }, null, 2)
                        }
                    ]
                };
                
            case "clear_files":
                try {
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
                    
                    // 重置索引
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
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    message: `已清空文件缓存，删除了 ${deletedCount} 个文件`,
                                    cache_stats: this.getCacheStats()
                                }, null, 2)
                            }
                        ]
                    };
                } catch (error) {
                    throw new Error(`Error clearing file cache: ${error.message}`);
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

        const articles = await this.fetchArticleDetails(pmidList);

        // 获取完整摘要
        if (include_full_text) {
            for (let article of articles) {
                try {
                    article.fullAbstract = await this.fetchFullAbstract(article.pmid);
                } catch (error) {
                    console.warn(`Failed to fetch full abstract for ${article.pmid}:`, error.message);
                }
            }
        }

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        articles: articles,
                        metadata: {
                            count: articles.length,
                            include_full_text: include_full_text
                        }
                    }, null, 2)
                }
            ]
        };
    }

    async handleExtractKeyInfo(args) {
        const { pmid, extract_sections = ["basic_info", "abstract_summary", "authors"], max_abstract_length = ABSTRACT_MAX_CHARS } = args;

        const articles = await this.fetchArticleDetails([pmid]);

        if (articles.length === 0) {
            throw new Error(`未找到PMID为 ${pmid} 的文献`);
        }

        const article = articles[0];
        const extracted = {};

        // 基本信息
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

        // 作者信息
        if (extract_sections.includes("authors")) {
            extracted.authors = {
                full_list: article.authors,
                first_author: article.authors[0] || null,
                last_author: article.authors[article.authors.length - 1] || null,
                author_count: article.authors.length
            };
        }

        // 摘要总结
        if (extract_sections.includes("abstract_summary") && article.abstract) {
            const truncatedAbstract = this.truncateText(article.abstract, max_abstract_length);
            extracted.abstract_summary = {
                full: truncatedAbstract,
                structured: this.extractAbstractSections(truncatedAbstract),
                key_points: this.extractKeyPoints(truncatedAbstract),
                word_count: truncatedAbstract.split(/\s+/).length
            };
        }

        // 关键词
        if (extract_sections.includes("keywords")) {
            extracted.keywords = {
                mesh_terms: article.meshTerms || [],
                keywords: article.keywords || [],
                combined: [...(article.meshTerms || []), ...(article.keywords || [])].slice(0, 15)
            };
        }

        // DOI链接
        if (extract_sections.includes("doi_link") && article.doi) {
            extracted.doi_link = {
                doi: article.doi,
                url: article.doi.startsWith('10.') ? `https://doi.org/${article.doi}` : article.url
            };
        }

        return {
            content: [
                {
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
                }
            ]
        };
    }

    async handleCrossReference(args) {
        const { pmid, reference_type = "similar", max_results = 10 } = args;

        // 简化实现：基于相似性搜索相关文献
        let relatedQuery = pmid; // 基础实现

        switch (reference_type) {
            case "similar":
                // 可以基于PMID获取相关文献
                relatedQuery = `${pmid}[uid]`;
                break;
            case "reviews":
                relatedQuery = `${pmid}[uid] AND review[publication type]`;
                break;
            default:
                relatedQuery = `${pmid}[uid]`;
        }

        const result = await this.searchPubMed(relatedQuery, max_results, 0, "relevance");

        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        base_pmid: pmid,
                        reference_type: reference_type,
                        related_articles: this.formatForLLM(result.articles, "llm_optimized"),
                        metadata: {
                            found: result.articles.length,
                            max_results: max_results
                        }
                    }, null, 2)
                }
            ]
        };
    }

    async handleBatchQuery(args) {
        const { pmids, query_format = "llm_optimized", include_abstracts = true } = args;

        if (pmids.length > 20) {
            throw new Error("批量查询最多支持20个PMID");
        }

        const articles = await this.fetchArticleDetails(pmids);

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
                formattedArticles = this.formatForLLM(articles, "llm_optimized");
                break;
        }

        return {
            content: [
                {
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
                }
            ]
        };
    }

    // ==================== 全文模式工具处理方法 ====================
    
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
            // 获取文献基本信息
            const articles = await this.fetchArticleDetails([pmid]);
            if (articles.length === 0) {
                throw new Error(`未找到PMID为 ${pmid} 的文献`);
            }
            
            const article = articles[0];
            
            // 检测开放获取状态
            const oaInfo = await this.detectOpenAccess(article);
            
            let downloadResult = null;
            if (oaInfo.isOpenAccess && (auto_download || FULLTEXT_AUTO_DOWNLOAD)) {
                // 检查是否已缓存
                const cached = this.isPDFCached(pmid);
                if (!cached.cached) {
                    downloadResult = await this.downloadPDF(pmid, oaInfo.downloadUrl, oaInfo);
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
            // 检查是否已缓存且不强制下载
            if (!force_download) {
                const cached = this.isPDFCached(pmid);
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
            
            // 获取文献信息并检测OA状态
            const articles = await this.fetchArticleDetails([pmid]);
            if (articles.length === 0) {
                throw new Error(`未找到PMID为 ${pmid} 的文献`);
            }
            
            const article = articles[0];
            const oaInfo = await this.detectOpenAccess(article);
            
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
            
            // 使用智能下载系统
            const downloadResult = await this.smartDownloadPDF(pmid, oaInfo.downloadUrl, oaInfo);
            
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
                case "stats":
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
                            text: JSON.stringify({
                                success: true,
                                action: "stats",
                                stats: stats
                            }, null, 2)
                        }]
                    };
                    
                case "list":
                    const listPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    if (!fs.existsSync(listPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    action: "list",
                                    papers: [],
                                    message: "No full-text papers cached"
                                }, null, 2)
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
                            text: JSON.stringify({
                                success: true,
                                action: "list",
                                papers: papers,
                                total: papers.length
                            }, null, 2)
                        }]
                    };
                    
                case "clean":
                    // 清理过期的PDF文件
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
                            text: JSON.stringify({
                                success: true,
                                action: "clean",
                                cleaned_files: cleaned,
                                message: `Cleaned ${cleaned} expired PDF files`
                            }, null, 2)
                        }]
                    };
                    
                case "clear":
                    // 清空所有全文缓存
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
                    
                    // 重置索引
                    const clearIndexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
                    const clearIndexData = {
                        version: CACHE_VERSION,
                        created: new Date().toISOString(),
                        fulltext_papers: {},
                        stats: {
                            totalPDFs: 0,
                            totalSize: 0,
                            lastCleanup: new Date().toISOString()
                        }
                    };
                    fs.writeFileSync(clearIndexPath, JSON.stringify(clearIndexData, null, 2));
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "clear",
                                deleted_files: deleted,
                                message: `Cleared all ${deleted} PDF files`
                            }, null, 2)
                        }]
                    };
                    
                default:
                    throw new Error(`Unknown action: ${action}`);
            }
            
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error.message,
                        action: action
                    }, null, 2)
                }]
            };
        }
    }
    
    // ==================== 新增工具处理方法 ====================
    
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
                    text: JSON.stringify({
                        success: false,
                        error: "Maximum 10 PMIDs allowed for batch download"
                    }, null, 2)
                }]
            };
        }
        
        try {
            console.error(`[BatchDownload] Starting batch download for ${pmids.length} papers`);
            
            // 构建下载列表
            const downloadList = [];
            for (const pmid of pmids) {
                const articles = await this.fetchArticleDetails([pmid]);
                if (articles.length > 0) {
                    const article = articles[0];
                    const oaInfo = await this.detectOpenAccess(article);
                    
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
            
            // 执行批量下载
            const results = await this.batchDownloadPDFs(downloadList);
            
            // 统计结果
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
                        system_info: this.detectSystemEnvironment()
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
                        pmids: pmids
                    }, null, 2)
                }]
            };
        }
    }
    
    async handleSystemCheck(args) {
        try {
            const systemInfo = await this.checkDownloadTools();
            
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        system_environment: systemInfo,
                        fulltext_mode: {
                            enabled: FULLTEXT_ENABLED,
                            mode: FULLTEXT_MODE,
                            auto_download: FULLTEXT_AUTO_DOWNLOAD
                        },
                        recommendations: this.getSystemRecommendations(systemInfo)
                    }, null, 2)
                }]
            };
            
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error.message
                    }, null, 2)
                }]
            };
        }
    }
    
    // 获取系统建议
    getSystemRecommendations(systemInfo) {
        const recommendations = [];
        
        if (systemInfo.system.isWindows) {
            const powershell = systemInfo.tools.find(t => t.name === 'PowerShell');
            if (powershell && powershell.available) {
                recommendations.push("✅ PowerShell available - Windows downloads will use Invoke-WebRequest");
            } else {
                recommendations.push("❌ PowerShell not available - Windows downloads may fail");
            }
        } else {
            const wget = systemInfo.tools.find(t => t.name === 'wget');
            const curl = systemInfo.tools.find(t => t.name === 'curl');
            
            if (wget && wget.available) {
                recommendations.push("✅ wget available - Recommended for Linux/macOS downloads");
            } else if (curl && curl.available) {
                recommendations.push("✅ curl available - Will use curl as fallback");
            } else {
                recommendations.push("❌ Neither wget nor curl available - Downloads may fail");
            }
        }
        
        if (FULLTEXT_ENABLED) {
            recommendations.push("✅ Full-text mode enabled");
        } else {
            recommendations.push("⚠️ Full-text mode disabled - Enable with FULLTEXT_MODE=enabled");
        }
        
        return recommendations;
    }
    
    // ==================== EndNote状态管理方法 ====================
    
    async handleEndNoteStatus(args) {
        const { action = "stats" } = args;
        
        try {
            switch (action) {
                case "stats":
                    const status = this.getEndNoteExportStatus();
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "stats",
                                endnote_export: status
                            }, null, 2)
                        }]
                    };
                    
                case "list":
                    const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    if (!fs.existsSync(indexPath)) {
                        return {
                            content: [{
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    action: "list",
                                    exported_papers: [],
                                    message: "No EndNote exports found"
                                }, null, 2)
                            }]
                        };
                    }
                    
                    const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
                    const papers = Object.values(indexData.exported_papers);
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "list",
                                exported_papers: papers,
                                total: papers.length
                            }, null, 2)
                        }]
                    };
                    
                case "clean":
                    // 清理过期的导出文件
                    let cleaned = 0;
                    const cleanPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    if (fs.existsSync(cleanPath)) {
                        const indexData = JSON.parse(fs.readFileSync(cleanPath, 'utf8'));
                        const now = Date.now();
                        const fileExpiry = 30 * 24 * 60 * 60 * 1000; // 30天过期
                        
                        for (const [pmid, info] of Object.entries(indexData.exported_papers)) {
                            const exportTime = new Date(info.exported).getTime();
                            const age = now - exportTime;
                            
                            if (age > fileExpiry) {
                                // 删除相关文件
                                const risFile = path.join(ENDNOTE_CACHE_DIR, `${pmid}.ris`);
                                const bibFile = path.join(ENDNOTE_CACHE_DIR, `${pmid}.bib`);
                                
                                if (fs.existsSync(risFile)) {
                                    fs.unlinkSync(risFile);
                                }
                                if (fs.existsSync(bibFile)) {
                                    fs.unlinkSync(bibFile);
                                }
                                
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
                            text: JSON.stringify({
                                success: true,
                                action: "clean",
                                message: `Cleaned ${cleaned} expired EndNote export files`
                            }, null, 2)
                        }]
                    };
                    
                case "clear":
                    // 清空所有EndNote导出文件
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
                    
                    // 重置索引
                    const clearIndexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
                    const clearIndexData = {
                        version: CACHE_VERSION,
                        created: new Date().toISOString(),
                        exported_papers: {},
                        stats: {
                            totalExports: 0,
                            risFiles: 0,
                            bibtexFiles: 0,
                            lastExport: null
                        }
                    };
                    fs.writeFileSync(clearIndexPath, JSON.stringify(clearIndexData, null, 2));
                    
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "clear",
                                message: `Cleared ${deleted} EndNote export files`
                            }, null, 2)
                        }]
                    };
                    
                default:
                    return {
                        content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                error: `Unknown action: ${action}`,
                                action: action
                            }, null, 2)
                        }]
                    };
            }
            
        } catch (error) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: error.message,
                        action: action
                    }, null, 2)
                }]
            };
        }
    }
    
    // ==================== EndNote导出核心方法 ====================
    
    // 初始化EndNote导出模式
    initEndNoteExport() {
        try {
            if (!fs.existsSync(ENDNOTE_CACHE_DIR)) {
                fs.mkdirSync(ENDNOTE_CACHE_DIR, { recursive: true });
                console.error(`[EndNote] Created endnote export directory: ${ENDNOTE_CACHE_DIR}`);
            }
            
            // 创建EndNote导出索引文件
            const endnoteIndexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            if (!fs.existsSync(endnoteIndexPath)) {
                const indexData = {
                    version: CACHE_VERSION,
                    created: new Date().toISOString(),
                    exported_papers: {},
                    stats: {
                        totalExports: 0,
                        risFiles: 0,
                        bibtexFiles: 0,
                        lastExport: null
                    }
                };
                fs.writeFileSync(endnoteIndexPath, JSON.stringify(indexData, null, 2));
                console.error(`[EndNote] Created endnote export index: ${endnoteIndexPath}`);
            }
            
            console.error(`[EndNote] EndNote export mode initialized`);
        } catch (error) {
            console.error(`[EndNote] Error initializing EndNote export mode:`, error.message);
        }
    }
    
    // 自动导出论文到EndNote格式
    async autoExportToEndNote(articles) {
        if (!ENDNOTE_EXPORT_ENABLED) {
            return { success: false, message: "EndNote export is disabled" };
        }
        
        try {
            const exportResults = [];
            
            for (const article of articles) {
                const exportResult = await this.exportArticleToEndNote(article);
                exportResults.push(exportResult);
            }
            
            // 更新导出索引
            await this.updateEndNoteIndex(exportResults);
            
            return {
                success: true,
                exported: exportResults.filter(r => r.success).length,
                failed: exportResults.filter(r => !r.success).length,
                results: exportResults
            };
            
        } catch (error) {
            console.error(`[EndNote] Error in auto export:`, error.message);
            return { success: false, error: error.message };
        }
    }
    
    // 导出单篇论文到EndNote格式
    async exportArticleToEndNote(article) {
        try {
            const pmid = article.pmid;
            const exportResults = {};
            
            // 导出RIS格式
            const risContent = this.generateRIS(article);
            const risFilePath = path.join(ENDNOTE_CACHE_DIR, `${pmid}.ris`);
            fs.writeFileSync(risFilePath, risContent, 'utf8');
            exportResults.ris = { success: true, filePath: risFilePath };
            
            // 导出BibTeX格式
            const bibtexContent = this.generateBibTeX(article);
            const bibtexFilePath = path.join(ENDNOTE_CACHE_DIR, `${pmid}.bib`);
            fs.writeFileSync(bibtexFilePath, bibtexContent, 'utf8');
            exportResults.bibtex = { success: true, filePath: bibtexFilePath };
            
            console.error(`[EndNote] Exported ${pmid} to RIS and BibTeX formats`);
            
            return {
                pmid: pmid,
                title: article.title,
                success: true,
                formats: exportResults,
                exported: new Date().toISOString()
            };
            
        } catch (error) {
            console.error(`[EndNote] Error exporting ${article.pmid}:`, error.message);
            return {
                pmid: article.pmid,
                title: article.title,
                success: false,
                error: error.message
            };
        }
    }
    
    // 生成RIS格式
    generateRIS(article) {
        const ris = [];
        
        // RIS格式头部
        ris.push('TY  - JOUR');
        
        // 标题
        if (article.title) {
            ris.push(`TI  - ${article.title}`);
        }
        
        // 作者
        if (article.authors && article.authors.length > 0) {
            article.authors.forEach(author => {
                ris.push(`AU  - ${author}`);
            });
        }
        
        // 期刊
        if (article.journal) {
            ris.push(`T2  - ${article.journal}`);
        }
        
        // 发表日期
        if (article.pubDate) {
            ris.push(`PY  - ${article.pubDate}`);
        }
        
        // 卷号
        if (article.volume) {
            ris.push(`VL  - ${article.volume}`);
        }
        
        // 期号
        if (article.issue) {
            ris.push(`IS  - ${article.issue}`);
        }
        
        // 页码
        if (article.pages) {
            ris.push(`SP  - ${article.pages}`);
        }
        
        // DOI
        if (article.doi) {
            ris.push(`DO  - ${article.doi}`);
        }
        
        // PMID
        if (article.pmid) {
            ris.push(`PMID - ${article.pmid}`);
        }
        
        // PMC ID
        if (article.pmcid) {
            ris.push(`PMC - ${article.pmcid}`);
        }
        
        // 摘要
        if (article.abstract) {
            ris.push(`AB  - ${article.abstract}`);
        }
        
        // 关键词
        if (article.keywords && article.keywords.length > 0) {
            article.keywords.forEach(keyword => {
                ris.push(`KW  - ${keyword}`);
            });
        }
        
        // URL
        if (article.url) {
            ris.push(`UR  - ${article.url}`);
        }
        
        // 语言
        ris.push('LA  - eng');
        
        // 数据库
        ris.push('DB  - PubMed');
        
        // RIS格式尾部
        ris.push('ER  - ');
        ris.push('');
        
        return ris.join('\n');
    }
    
    // 生成BibTeX格式
    generateBibTeX(article) {
        const pmid = article.pmid;
        const firstAuthor = article.authors && article.authors.length > 0 
            ? article.authors[0].replace(/\s+/g, '').toLowerCase() 
            : 'unknown';
        const year = article.pubDate ? article.pubDate.split('-')[0] : 'unknown';
        const citeKey = `${firstAuthor}${year}${pmid}`;
        
        const bibtex = [];
        bibtex.push(`@article{${citeKey},`);
        bibtex.push(`  title = {${article.title || 'Unknown Title'}},`);
        
        if (article.authors && article.authors.length > 0) {
            bibtex.push(`  author = {${article.authors.join(' and ')}},`);
        }
        
        if (article.journal) {
            bibtex.push(`  journal = {${article.journal}},`);
        }
        
        if (article.pubDate) {
            bibtex.push(`  year = {${article.pubDate}},`);
        }
        
        if (article.volume) {
            bibtex.push(`  volume = {${article.volume}},`);
        }
        
        if (article.issue) {
            bibtex.push(`  number = {${article.issue}},`);
        }
        
        if (article.pages) {
            bibtex.push(`  pages = {${article.pages}},`);
        }
        
        if (article.doi) {
            bibtex.push(`  doi = {${article.doi}},`);
        }
        
        if (article.pmid) {
            bibtex.push(`  pmid = {${article.pmid}},`);
        }
        
        if (article.pmcid) {
            bibtex.push(`  pmcid = {${article.pmcid}},`);
        }
        
        if (article.abstract) {
            bibtex.push(`  abstract = {${article.abstract}},`);
        }
        
        bibtex.push(`  publisher = {PubMed},`);
        bibtex.push(`  url = {https://pubmed.ncbi.nlm.nih.gov/${pmid}/},`);
        bibtex.push(`}`);
        bibtex.push('');
        
        return bibtex.join('\n');
    }
    
    // 更新EndNote导出索引
    async updateEndNoteIndex(exportResults) {
        try {
            const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            
            // 更新导出记录
            exportResults.forEach(result => {
                if (result.success) {
                    indexData.exported_papers[result.pmid] = {
                        pmid: result.pmid,
                        title: result.title,
                        formats: result.formats,
                        exported: result.exported
                    };
                }
            });
            
            // 更新统计信息
            indexData.stats.totalExports = Object.keys(indexData.exported_papers).length;
            indexData.stats.risFiles = Object.values(indexData.exported_papers)
                .filter(paper => paper.formats && paper.formats.ris && paper.formats.ris.success).length;
            indexData.stats.bibtexFiles = Object.values(indexData.exported_papers)
                .filter(paper => paper.formats && paper.formats.bibtex && paper.formats.bibtex.success).length;
            indexData.stats.lastExport = new Date().toISOString();
            
            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
            
        } catch (error) {
            console.error(`[EndNote] Error updating export index:`, error.message);
        }
    }
    
    // 获取EndNote导出状态
    getEndNoteExportStatus() {
        try {
            const indexPath = path.join(ENDNOTE_CACHE_DIR, 'index.json');
            if (!fs.existsSync(indexPath)) {
                return {
                    enabled: ENDNOTE_EXPORT_ENABLED,
                    directory: ENDNOTE_CACHE_DIR,
                    totalExports: 0,
                    risFiles: 0,
                    bibtexFiles: 0,
                    lastExport: null
                };
            }
            
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            return {
                enabled: ENDNOTE_EXPORT_ENABLED,
                directory: ENDNOTE_CACHE_DIR,
                totalExports: indexData.stats.totalExports,
                risFiles: indexData.stats.risFiles,
                bibtexFiles: indexData.stats.bibtexFiles,
                lastExport: indexData.stats.lastExport,
                supportedFormats: ENDNOTE_EXPORT_FORMATS
            };
            
        } catch (error) {
            console.error(`[EndNote] Error getting export status:`, error.message);
            return {
                enabled: ENDNOTE_EXPORT_ENABLED,
                error: error.message
            };
        }
    }

    // ==================== 全文模式核心方法 ====================
    
    // 检测OA论文和全文可用性
    async detectOpenAccess(article) {
        const oaInfo = {
            isOpenAccess: false,
            sources: [],
            downloadUrl: null,
            pmcid: null,
            doi: article.doi
        };
        
        try {
            // 1. 检查PMC免费全文
            if (article.pmcid || article.publicationTypes?.includes('PMC')) {
                const pmcInfo = await this.checkPMCContent(article.pmid);
                if (pmcInfo.isAvailable) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('PMC');
                    oaInfo.downloadUrl = pmcInfo.downloadUrl;
                    oaInfo.pmcid = pmcInfo.pmcid;
                }
            }
            
            // 2. 检查DOI的Unpaywall
            if (article.doi && !oaInfo.isOpenAccess) {
                const unpaywallInfo = await this.checkUnpaywall(article.doi);
                if (unpaywallInfo.isOpenAccess) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('Unpaywall');
                    oaInfo.downloadUrl = unpaywallInfo.downloadUrl;
                }
            }
            
            // 3. 检查出版商直接OA
            if (!oaInfo.isOpenAccess && article.doi) {
                const publisherInfo = await this.checkPublisherOA(article.doi);
                if (publisherInfo.isOpenAccess) {
                    oaInfo.isOpenAccess = true;
                    oaInfo.sources.push('Publisher');
                    oaInfo.downloadUrl = publisherInfo.downloadUrl;
                }
            }
            
        } catch (error) {
            console.error(`[FullText] Error detecting OA for ${article.pmid}:`, error.message);
        }
        
        return oaInfo;
    }
    
    // 检查PMC内容
    async checkPMCContent(pmid) {
        try {
            const pmcUrl = `${PMC_BASE_URL}/?term=${pmid}`;
            const response = await fetch(pmcUrl, { timeout: REQUEST_TIMEOUT });
            
            if (response.ok) {
                const html = await response.text();
                // 检查是否有PMC免费全文
                const pmcMatch = html.match(/PMC(\d+)/);
                if (pmcMatch) {
                    const pmcid = `PMC${pmcMatch[1]}`;
                    return {
                        isAvailable: true,
                        pmcid: pmcid,
                        downloadUrl: `${PMC_BASE_URL}/articles/${pmcid}/pdf/`
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking PMC for ${pmid}:`, error.message);
        }
        
        return { isAvailable: false };
    }
    
    // 检查Unpaywall
    async checkUnpaywall(doi) {
        try {
            const unpaywallUrl = `${UNPAYWALL_API_URL}/${doi}?email=${process.env.PUBMED_EMAIL || 'user@example.com'}`;
            const response = await fetch(unpaywallUrl, { timeout: REQUEST_TIMEOUT });
            
            if (response.ok) {
                const data = await response.json();
                if (data.is_oa && data.best_oa_location) {
                    return {
                        isOpenAccess: true,
                        downloadUrl: data.best_oa_location.url,
                        source: data.best_oa_location.source
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking Unpaywall for ${doi}:`, error.message);
        }
        
        return { isOpenAccess: false };
    }
    
    // 检查出版商直接OA
    async checkPublisherOA(doi) {
        try {
            const doiUrl = `https://doi.org/${doi}`;
            const response = await fetch(doiUrl, { 
                timeout: REQUEST_TIMEOUT,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)'
                }
            });
            
            if (response.ok) {
                const html = await response.text();
                // 检查是否有免费PDF链接
                const pdfMatch = html.match(/href="([^"]*\.pdf[^"]*)"/i);
                if (pdfMatch) {
                    return {
                        isOpenAccess: true,
                        downloadUrl: pdfMatch[1]
                    };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking publisher OA for ${doi}:`, error.message);
        }
        
        return { isOpenAccess: false };
    }
    
    // 下载PDF文件
    async downloadPDF(pmid, downloadUrl, oaInfo) {
        try {
            console.error(`[FullText] Downloading PDF for ${pmid} from ${oaInfo.sources.join(', ')}`);
            
            const response = await fetch(downloadUrl, {
                timeout: 60000, // 60秒超时
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; PubMed-MCP-Server/2.0)',
                    'Accept': 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength) > MAX_PDF_SIZE) {
                throw new Error(`PDF too large: ${contentLength} bytes (max: ${MAX_PDF_SIZE})`);
            }
            
            const buffer = await response.buffer();
            if (buffer.length > MAX_PDF_SIZE) {
                throw new Error(`PDF too large: ${buffer.length} bytes (max: ${MAX_PDF_SIZE})`);
            }
            
            // 保存PDF文件
            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            fs.writeFileSync(pdfPath, buffer);
            
            // 更新全文索引
            await this.updateFullTextIndex(pmid, {
                pmid: pmid,
                downloadUrl: downloadUrl,
                sources: oaInfo.sources,
                filePath: `${pmid}.pdf`,
                fileSize: buffer.length,
                downloaded: new Date().toISOString(),
                pmcid: oaInfo.pmcid,
                doi: oaInfo.doi
            });
            
            console.error(`[FullText] PDF downloaded successfully: ${pmid} (${buffer.length} bytes)`);
            return {
                success: true,
                filePath: pdfPath,
                fileSize: buffer.length,
                sources: oaInfo.sources
            };
            
        } catch (error) {
            console.error(`[FullText] Error downloading PDF for ${pmid}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    // 更新全文索引
    async updateFullTextIndex(pmid, fulltextInfo) {
        try {
            const indexPath = path.join(FULLTEXT_CACHE_DIR, 'index.json');
            const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            
            indexData.fulltext_papers[pmid] = {
                ...fulltextInfo,
                cached: new Date().toISOString()
            };
            
            indexData.stats.totalPDFs = Object.keys(indexData.fulltext_papers).length;
            indexData.stats.totalSize = Object.values(indexData.fulltext_papers)
                .reduce((sum, paper) => sum + (paper.fileSize || 0), 0);
            
            fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
            
        } catch (error) {
            console.error(`[FullText] Error updating fulltext index:`, error.message);
        }
    }
    
    // 检查PDF是否已缓存
    isPDFCached(pmid) {
        try {
            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            if (fs.existsSync(pdfPath)) {
                const stats = fs.statSync(pdfPath);
                const age = Date.now() - stats.mtime.getTime();
                if (age < PDF_CACHE_EXPIRY) {
                    return {
                        cached: true,
                        filePath: pdfPath,
                        fileSize: stats.size,
                        age: age
                    };
                } else {
                    // 删除过期文件
                    fs.unlinkSync(pdfPath);
                    return { cached: false };
                }
            }
        } catch (error) {
            console.error(`[FullText] Error checking PDF cache for ${pmid}:`, error.message);
        }
        
        return { cached: false };
    }
    
    // 获取PDF文本内容（简单实现）
    async extractPDFText(pmid) {
        try {
            const pdfPath = path.join(FULLTEXT_CACHE_DIR, `${pmid}.pdf`);
            if (!fs.existsSync(pdfPath)) {
                return null;
            }
            
            // 这里可以集成PDF解析库如pdf-parse
            // 为了简化，先返回基本信息
            const stats = fs.statSync(pdfPath);
            return {
                pmid: pmid,
                filePath: pdfPath,
                fileSize: stats.size,
                extracted: false, // 需要PDF解析库
                note: "PDF text extraction requires additional library (pdf-parse)"
            };
            
        } catch (error) {
            console.error(`[FullText] Error extracting PDF text for ${pmid}:`, error.message);
            return null;
        }
    }

    // ==================== 跨平台智能下载系统 ====================
    
    // 检测系统环境
    detectSystemEnvironment() {
        const platform = os.platform();
        const arch = os.arch();
        
        return {
            platform: platform,
            arch: arch,
            isWindows: platform === 'win32',
            isMacOS: platform === 'darwin',
            isLinux: platform === 'linux',
            downloadCommand: this.getDownloadCommand(platform),
            userAgent: this.getUserAgent(platform)
        };
    }
    
    // 获取下载命令
    getDownloadCommand(platform) {
        switch (platform) {
            case 'win32':
                return 'powershell'; // 使用PowerShell的Invoke-WebRequest
            case 'darwin':
            case 'linux':
                return 'wget'; // 优先使用wget
            default:
                return 'curl'; // 备用方案
        }
    }
    
    // 获取用户代理
    getUserAgent(platform) {
        const userAgents = {
            'win32': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'darwin': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'linux': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        return userAgents[platform] || userAgents['linux'];
    }
    
    // 智能下载PDF（跨平台）
    async smartDownloadPDF(pmid, downloadUrl, oaInfo) {
        const system = this.detectSystemEnvironment();
        const downloadDir = FULLTEXT_CACHE_DIR;
        const filename = `${pmid}.pdf`;
        const filePath = path.join(downloadDir, filename);
        
        console.error(`[SmartDownload] Starting download for ${pmid} on ${system.platform}`);
        console.error(`[SmartDownload] URL: ${downloadUrl}`);
        console.error(`[SmartDownload] Command: ${system.downloadCommand}`);
        
        try {
            let downloadResult;
            
            if (system.isWindows) {
                downloadResult = await this.downloadWithPowerShell(downloadUrl, filePath, system);
            } else {
                downloadResult = await this.downloadWithWgetOrCurl(downloadUrl, filePath, system);
            }
            
            if (downloadResult.success) {
                // 更新全文索引
                await this.updateFullTextIndex(pmid, {
                    pmid: pmid,
                    downloadUrl: downloadUrl,
                    sources: oaInfo.sources,
                    filePath: filename,
                    fileSize: downloadResult.fileSize,
                    downloaded: new Date().toISOString(),
                    pmcid: oaInfo.pmcid,
                    doi: oaInfo.doi,
                    downloadMethod: system.downloadCommand
                });
                
                console.error(`[SmartDownload] Successfully downloaded ${pmid} (${downloadResult.fileSize} bytes)`);
            }
            
            return downloadResult;
            
        } catch (error) {
            console.error(`[SmartDownload] Error downloading ${pmid}:`, error.message);
            return {
                success: false,
                error: error.message,
                pmid: pmid
            };
        }
    }
    
    // Windows PowerShell下载
    async downloadWithPowerShell(downloadUrl, filePath, system) {
        return new Promise((resolve) => {
            const command = `powershell -Command "& {Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${filePath}' -UserAgent '${system.userAgent}' -TimeoutSec 60}"`;
            
            console.error(`[PowerShell] Executing: ${command}`);
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[PowerShell] Error: ${error.message}`);
                    resolve({
                        success: false,
                        error: error.message,
                        stderr: stderr
                    });
                    return;
                }
                
                // 检查文件是否下载成功
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    if (stats.size > 0) {
                        resolve({
                            success: true,
                            filePath: filePath,
                            fileSize: stats.size,
                            method: 'PowerShell'
                        });
                    } else {
                        resolve({
                            success: false,
                            error: 'Downloaded file is empty',
                            filePath: filePath
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        error: 'File not found after download',
                        stderr: stderr
                    });
                }
            });
        });
    }
    
    // Linux/macOS wget或curl下载
    async downloadWithWgetOrCurl(downloadUrl, filePath, system) {
        return new Promise((resolve) => {
            let command;
            
            // 优先使用wget，如果不存在则使用curl
            if (system.downloadCommand === 'wget') {
                command = `wget --user-agent='${system.userAgent}' --timeout=60 --tries=3 --continue -O '${filePath}' '${downloadUrl}'`;
            } else {
                command = `curl -L --user-agent '${system.userAgent}' --connect-timeout 60 --max-time 300 -o '${filePath}' '${downloadUrl}'`;
            }
            
            console.error(`[${system.downloadCommand}] Executing: ${command}`);
            
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[${system.downloadCommand}] Error: ${error.message}`);
                    resolve({
                        success: false,
                        error: error.message,
                        stderr: stderr
                    });
                    return;
                }
                
                // 检查文件是否下载成功
                if (fs.existsSync(filePath)) {
                    const stats = fs.statSync(filePath);
                    if (stats.size > 0) {
                        resolve({
                            success: true,
                            filePath: filePath,
                            fileSize: stats.size,
                            method: system.downloadCommand
                        });
                    } else {
                        resolve({
                            success: false,
                            error: 'Downloaded file is empty',
                            filePath: filePath
                        });
                    }
                } else {
                    resolve({
                        success: false,
                        error: 'File not found after download',
                        stderr: stderr
                    });
                }
            });
        });
    }
    
    // 批量后台下载
    async batchDownloadPDFs(downloadList) {
        const system = this.detectSystemEnvironment();
        const results = [];
        
        console.error(`[BatchDownload] Starting batch download for ${downloadList.length} papers on ${system.platform}`);
        
        for (let i = 0; i < downloadList.length; i++) {
            const item = downloadList[i];
            console.error(`[BatchDownload] Processing ${i + 1}/${downloadList.length}: ${item.pmid}`);
            
            try {
                // 模拟人类操作间隔（1-3秒随机延迟）
                const delay = Math.random() * 2000 + 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                
                const result = await this.smartDownloadPDF(item.pmid, item.downloadUrl, item.oaInfo);
                results.push({
                    pmid: item.pmid,
                    title: item.title,
                    result: result
                });
                
                // 下载间隔（避免过于频繁的请求）
                if (i < downloadList.length - 1) {
                    const interval = Math.random() * 3000 + 2000; // 2-5秒间隔
                    console.error(`[BatchDownload] Waiting ${Math.round(interval/1000)}s before next download...`);
                    await new Promise(resolve => setTimeout(resolve, interval));
                }
                
            } catch (error) {
                console.error(`[BatchDownload] Error processing ${item.pmid}:`, error.message);
                results.push({
                    pmid: item.pmid,
                    title: item.title,
                    result: {
                        success: false,
                        error: error.message
                    }
                });
            }
        }
        
        return results;
    }
    
    // 检查下载工具可用性
    async checkDownloadTools() {
        const system = this.detectSystemEnvironment();
        const tools = [];
        
        if (system.isWindows) {
            // 检查PowerShell
            try {
                await new Promise((resolve, reject) => {
                    exec('powershell -Command "Get-Host"', (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                tools.push({ name: 'PowerShell', available: true });
            } catch (error) {
                tools.push({ name: 'PowerShell', available: false, error: error.message });
            }
        } else {
            // 检查wget
            try {
                await new Promise((resolve, reject) => {
                    exec('wget --version', (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                tools.push({ name: 'wget', available: true });
            } catch (error) {
                tools.push({ name: 'wget', available: false, error: error.message });
            }
            
            // 检查curl
            try {
                await new Promise((resolve, reject) => {
                    exec('curl --version', (error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                });
                tools.push({ name: 'curl', available: true });
            } catch (error) {
                tools.push({ name: 'curl', available: false, error: error.message });
            }
        }
        
        return {
            system: system,
            tools: tools,
            recommended: system.downloadCommand
        };
    }

    async run() {
        if (MODE === 'sse') {
            await this.runSSE();
        } else {
            await this.runStdio();
        }
    }

    async runStdio() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("PubMed Data Server v2.0 running on stdio");
        console.error(`[AbstractMode] ${ABSTRACT_MODE} (max_chars=${ABSTRACT_MAX_CHARS}) - ${ABSTRACT_MODE_NOTE}`);
        if (FULLTEXT_ENABLED) {
            console.error(`[FullTextMode] ${FULLTEXT_MODE} - ${FULLTEXT_AUTO_DOWNLOAD ? 'Auto-download enabled' : 'Manual download only'}`);
        }
    }

    async runSSE() {
        // 存储活跃的SSE传输会话（每个会话包含transport和对应的server实例）
        const sessions = new Map();

        // 创建新Server实例的辅助方法
        const createServerInstance = () => {
            const newServer = new Server(
                {
                    name: "pubmed-data-server",
                    version: "2.0.0",
                },
                {
                    capabilities: {
                        tools: {},
                    },
                }
            );
            // 复制当前服务器的请求处理器
            this.setupRequestHandlers(newServer);
            return newServer;
        };

        const httpServer = http.createServer(async (req, res) => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            const pathname = url.pathname;

            // 处理CORS（如果需要）
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200).end();
                return;
            }

            // GET /sse - 建立SSE连接
            if (req.method === 'GET' && pathname === '/sse') {
                const endpoint = '/message';
                const transport = new SSEServerTransport(endpoint, res);
                
                // 为每个连接创建独立的Server实例
                const sessionServer = createServerInstance();
                
                // 设置传输的事件处理器
                transport.onclose = () => {
                    const sessionId = transport.sessionId;
                    sessions.delete(sessionId);
                    console.error(`[SSE] Session ${sessionId} closed`);
                };

                transport.onerror = (error) => {
                    console.error(`[SSE] Transport error:`, error);
                };

                // 连接独立的服务器实例（connect()会自动调用transport.start()）
                await sessionServer.connect(transport);
                
                // 存储会话（包含transport和server实例）
                sessions.set(transport.sessionId, { transport, server: sessionServer });
                
                console.error(`[SSE] New session established: ${transport.sessionId}`);
                return;
            }

            // POST /message - 接收客户端消息
            if (req.method === 'POST' && pathname === '/message') {
                const sessionId = url.searchParams.get('sessionId');
                
                if (!sessionId) {
                    res.writeHead(400).end('Missing sessionId parameter');
                    return;
                }

                const session = sessions.get(sessionId);
                if (!session) {
                    res.writeHead(404).end('Session not found');
                    return;
                }

                try {
                    await session.transport.handlePostMessage(req, res);
                } catch (error) {
                    console.error(`[SSE] Error handling POST message:`, error);
                    if (!res.headersSent) {
                        res.writeHead(500).end('Internal server error');
                    }
                }
                return;
            }

            // 健康检查端点
            if (req.method === 'GET' && pathname === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ 
                    status: 'ok', 
                    mode: 'sse',
                    sessions: sessions.size 
                }));
                return;
            }

            // 404处理
            res.writeHead(404).end('Not found');
        });

        httpServer.listen(PORT, () => {
            console.error("PubMed Data Server v2.0 running on SSE");
            console.error(`[SSE] Server listening on http://0.0.0.0:${PORT}`);
            console.error(`[SSE] SSE endpoint: http://0.0.0.0:${PORT}/sse`);
            console.error(`[SSE] Message endpoint: http://0.0.0.0:${PORT}/message`);
            console.error(`[SSE] Health check: http://0.0.0.0:${PORT}/health`);
            console.error(`[AbstractMode] ${ABSTRACT_MODE} (max_chars=${ABSTRACT_MAX_CHARS}) - ${ABSTRACT_MODE_NOTE}`);
            if (FULLTEXT_ENABLED) {
                console.error(`[FullTextMode] ${FULLTEXT_MODE} - ${FULLTEXT_AUTO_DOWNLOAD ? 'Auto-download enabled' : 'Manual download only'}`);
            }
        });

        httpServer.on('error', (error) => {
            console.error(`[SSE] Server error:`, error);
            process.exit(1);
        });
    }
}

// 启动服务器
const server = new PubMedDataServer();
server.run().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
