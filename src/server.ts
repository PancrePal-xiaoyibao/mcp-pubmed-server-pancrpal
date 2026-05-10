import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MODE, FULLTEXT_ENABLED } from './config.js';
import { MemoryCache } from './cache/memory-cache.js';
import { FileCache } from './cache/file-cache.js';
import { PubMedClient } from './api/pubmed-client.js';
import { ApiKeyPool } from './api/key-pool.js';
import { FulltextService } from './services/fulltext.js';
import { getToolDefinitions } from './tools/definitions.js';
import { ToolHandlers } from './tools/handlers.js';
import { startStdio } from './transport/stdio.js';
import { startStreamableHttp } from './transport/streamable-http.js';

export class PubMedDataServer {
  private server: Server;
  private toolHandlers: ToolHandlers;

  constructor() {
    this.server = new Server(
      { name: 'pubmed-data-server', version: '2.0.0' },
      { capabilities: { tools: {} } },
    );

    const memoryCache = new MemoryCache();
    const fileCache = new FileCache();
    fileCache.initDirectories();

    const apiKeyPool = new ApiKeyPool();
    const pubmedClient = new PubMedClient({ memoryCache, fileCache, apiKeyPool });

    const fulltextService = new FulltextService();
    if (FULLTEXT_ENABLED) fulltextService.init();

    this.toolHandlers = new ToolHandlers({
      pubmedClient, memoryCache, fileCache, fulltextService, apiKeyPool,
    });

    this.setupHandlers();
  }

  setupHandlers(server?: Server): void {
    const target = server || this.server;

    target.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: getToolDefinitions(),
    }));

    target.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        return await this.toolHandlers.route(name, args as Record<string, unknown>);
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${(error as Error).message}` }],
        };
      }
    });
  }

  async run(): Promise<void> {
    if (MODE === 'streamableHttp') {
      await startStreamableHttp((server) => this.setupHandlers(server));
    } else {
      await startStdio(this.server);
    }
  }
}
