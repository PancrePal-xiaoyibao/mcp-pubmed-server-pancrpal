import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MODE, FULLTEXT_ENABLED, ENDNOTE_EXPORT_ENABLED } from './config.js';
import { MemoryCache } from './cache/memory-cache.js';
import { FileCache } from './cache/file-cache.js';
import { PubMedClient } from './api/pubmed-client.js';
import { ApiKeyPool } from './api/key-pool.js';
import { FulltextService } from './services/fulltext.js';
import { EndNoteService } from './services/endnote.js';
import { getToolDefinitions } from './tools/definitions.js';
import { ToolHandlers } from './tools/handlers.js';
import { startStdio } from './transport/stdio.js';
import { startStreamableHttp } from './transport/streamable-http.js';

export class PubMedDataServer {
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

        // 初始化缓存
        this.memoryCache = new MemoryCache();
        this.fileCache = new FileCache();
        this.fileCache.initDirectories();

        // 初始化 API Key 池
        this.apiKeyPool = new ApiKeyPool();

        // 初始化 API 客户端
        this.pubmedClient = new PubMedClient({
            memoryCache: this.memoryCache,
            fileCache: this.fileCache,
            apiKeyPool: this.apiKeyPool
        });

        // 初始化可选服务
        this.fulltextService = new FulltextService();
        this.endnoteService = new EndNoteService();

        if (FULLTEXT_ENABLED) {
            this.fulltextService.init();
        }

        if (ENDNOTE_EXPORT_ENABLED) {
            this.endnoteService.init();
        }

        // 初始化工具处理器
        this.toolHandlers = new ToolHandlers({
            pubmedClient: this.pubmedClient,
            memoryCache: this.memoryCache,
            fileCache: this.fileCache,
            fulltextService: this.fulltextService,
            endnoteService: this.endnoteService,
            apiKeyPool: this.apiKeyPool
        });

        // 注册请求处理器
        this.setupRequestHandlers();
    }

    setupRequestHandlers(server = null) {
        const targetServer = server || this.server;

        targetServer.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: getToolDefinitions()
            };
        });

        targetServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            try {
                return await this.toolHandlers.route(name, args);
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

    async run() {
        if (MODE === 'streamableHttp') {
            await startStreamableHttp((server) => this.setupRequestHandlers(server));
        } else {
            await startStdio(this.server);
        }
    }
}
