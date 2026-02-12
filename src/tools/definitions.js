import { FULLTEXT_ENABLED, ENDNOTE_EXPORT_ENABLED } from '../config.js';

export function getToolDefinitions() {
    const tools = [
        {
            name: "pubmed_search",
            title: "PubMed Literature Search",
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_quick_search",
            title: "PubMed Quick Search",
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_cache_info",
            title: "Cache Management",
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
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false
            }
        },
        {
            name: "pubmed_get_details",
            title: "Article Detail Retrieval",
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_extract_key_info",
            title: "Key Information Extraction",
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
                                "basic_info",
                                "authors",
                                "abstract_summary",
                                "keywords",
                                "methods",
                                "results",
                                "conclusions",
                                "references",
                                "doi_link"
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_cross_reference",
            title: "Cross-Reference Search",
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
                        enum: ["citing", "cited", "similar", "reviews"],
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_batch_query",
            title: "Batch Article Query",
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
                        enum: ["concise", "detailed", "llm_optimized"],
                        default: "llm_optimized"
                    },
                    include_abstracts: {
                        type: "boolean",
                        description: "是否包含摘要",
                        default: true
                    }
                },
                required: ["pmids"]
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_detect_fulltext",
            title: "Fulltext Availability Detection",
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
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_download_fulltext",
            title: "Fulltext PDF Download",
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
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_fulltext_status",
            title: "Fulltext Cache Status",
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
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false
            }
        },
        {
            name: "pubmed_batch_download",
            title: "Batch PDF Download",
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
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: true
            }
        },
        {
            name: "pubmed_system_check",
            title: "System Environment Check",
            description: "检查系统环境和下载工具可用性",
            inputSchema: {
                type: "object",
                properties: {}
            },
            annotations: {
                readOnlyHint: true,
                idempotentHint: true,
                openWorldHint: false
            }
        },
        {
            name: "pubmed_endnote_status",
            title: "EndNote Export Status",
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
            },
            annotations: {
                readOnlyHint: false,
                destructiveHint: true,
                idempotentHint: false,
                openWorldHint: false
            }
        }
    ];

    return tools;
}
