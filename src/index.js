#!/usr/bin/env node
import 'dotenv/config';

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fetch from "node-fetch";

const PUBMED_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const RATE_LIMIT_DELAY = 334; // PubMed rate limit: 3 requests per second
// Abstract truncation modes (env-driven)
const ABSTRACT_MODE = (process.env.ABSTRACT_MODE || 'quick').toLowerCase() === 'deep' ? 'deep' : 'quick';
const ABSTRACT_MAX_CHARS = ABSTRACT_MODE === 'deep' ? 6000 : 1500;
const ABSTRACT_MODE_NOTE = ABSTRACT_MODE === 'deep'
    ? 'Deep mode: up to 6000 chars per abstract. Requires large model context (>=120k tokens recommended for batch usage).'
    : 'Quick mode: up to 1500 chars per abstract (may be incomplete). Optimized for fast retrieval.';

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
    }

    setupRequestHandlers() {
        // 列出可用工具
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
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
                                }
                            },
                            required: ["query"]
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
                                    default: 2000,
                                    minimum: 500,
                                    maximum: 5000
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
                    }
                ]
            };
        });

        // 处理工具调用
        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                switch (name) {
                    case "pubmed_search":
                        return await this.handleSearch(args);
                    case "pubmed_get_details":
                        return await this.handleGetDetails(args);
                    case "pubmed_extract_key_info":
                        return await this.handleExtractKeyInfo(args);
                    case "pubmed_cross_reference":
                        return await this.handleCrossReference(args);
                    case "pubmed_batch_query":
                        return await this.handleBatchQuery(args);
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

    async searchPubMed(query, maxResults = 20, daysBack = 0, sortBy = "relevance") {
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

        const response = await fetch(searchUrl.toString());
        if (!response.ok) {
            throw new Error(`PubMed search failed: ${response.statusText}`);
        }

        const data = await response.json();
        const ids = data.esearchresult?.idlist || [];

        if (ids.length === 0) {
            return { articles: [], total: 0, query: searchQuery };
        }

        const articles = await this.fetchArticleDetails(ids);
        return { articles, total: data.esearchresult?.count || 0, query: searchQuery };
    }

    async fetchArticleDetails(ids) {
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

        const response = await fetch(summaryUrl.toString());
        if (!response.ok) {
            throw new Error(`Failed to fetch article details: ${response.statusText}`);
        }

        const data = await response.json();

        return ids.map(id => {
            const article = data.result[id];
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

        const response = await fetch(abstractUrl.toString());
        if (!response.ok) {
            throw new Error(`Failed to fetch abstract: ${response.statusText}`);
        }

        return await response.text();
    }

    // 格式化文献信息为LLM友好格式
    formatForLLM(articles, format = "llm_optimized") {
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

        // LLM优化格式
        return articles.map(article => {
            const structured = {
                identifier: `PMID: ${article.pmid}`,
                title: article.title,
                citation: `${article.authors.slice(0, 3).join(', ')}${article.authors.length > 3 ? ' et al.' : ''} ${article.journal}, ${article.publicationDate}`,
                url: article.url
            };

            if (article.abstract) {
                structured.abstract = this.truncateText(article.abstract, ABSTRACT_MAX_CHARS);
                structured.key_points = this.extractKeyPoints(article.abstract);
            }

            if (article.meshTerms && article.meshTerms.length > 0) {
                structured.keywords = article.meshTerms.slice(0, 10);
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
        const { query, max_results = 20, days_back = 0, include_abstract = true, sort_by = "relevance" } = args;

        const result = await this.searchPubMed(query, max_results, days_back, sort_by);

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
        const formattedArticles = this.formatForLLM(result.articles, "llm_optimized");

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
                            days_back: days_back,
                            sort_by: sort_by,
                            include_abstract: include_abstract
                        }
                    }, null, 2)
                }
            ]
        };
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
        const { pmid, extract_sections = ["basic_info", "abstract_summary", "authors"], max_abstract_length = 2000 } = args;

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
                            max_abstract_length: max_abstract_length
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

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("PubMed Data Server v2.0 running on stdio");
        console.error(`[AbstractMode] ${ABSTRACT_MODE} (max_chars=${ABSTRACT_MAX_CHARS}) - ${ABSTRACT_MODE_NOTE}`);
    }
}

// 启动服务器
const server = new PubMedDataServer();
server.run().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});