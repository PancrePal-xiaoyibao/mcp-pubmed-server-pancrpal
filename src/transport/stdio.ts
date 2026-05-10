import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ABSTRACT_MODE, ABSTRACT_MAX_CHARS, FULLTEXT_ENABLED, FULLTEXT_MODE } from '../config.js';

export async function startStdio(server: Server): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`PubMed MCP Server v2.0 running on stdio`);
  console.error(`[Config] abstract=${ABSTRACT_MODE} (max ${ABSTRACT_MAX_CHARS} chars)`);
  if (FULLTEXT_ENABLED) {
    console.error(`[Config] fulltext=${FULLTEXT_MODE}`);
  }
}
