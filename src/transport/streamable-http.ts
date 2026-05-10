import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { PORT, ABSTRACT_MODE, ABSTRACT_MAX_CHARS, FULLTEXT_ENABLED, FULLTEXT_MODE } from '../config.js';

interface Session {
  transport: StreamableHTTPServerTransport;
  server: Server;
}

export async function startStreamableHttp(
  setupRequestHandlers: (server: Server) => void,
): Promise<void> {
  const sessions = new Map<string, Session>();

  const createServer = () => {
    const s = new Server(
      { name: 'pubmed-data-server', version: '2.0.0' },
      { capabilities: { tools: {} } },
    );
    setupRequestHandlers(s);
    return s;
  };

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, MCP-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
    if (_req.method === 'OPTIONS') { res.writeHead(200).end(); return; }
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'streamableHttp', sessions: sessions.size });
  });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'No active session. Send an initialize request first.' });
      return;
    }

    const server = createServer();
    let newSessionId: string | null = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (id: string) => {
        newSessionId = id;
        sessions.set(id, { transport, server });
      },
    });

    transport.onclose = async () => {
      if (newSessionId) sessions.delete(newSessionId);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) { res.status(400).send('Invalid or missing session ID'); return; }
    await session.transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session) { res.status(400).send('Invalid or missing session ID'); return; }
    await session.transport.handleRequest(req, res);
  });

  app.listen(PORT, () => {
    console.error(`PubMed MCP Server v2.0 running on Streamable HTTP`);
    console.error(`[HTTP] http://0.0.0.0:${PORT}/mcp`);
    console.error(`[Config] abstract=${ABSTRACT_MODE} (max ${ABSTRACT_MAX_CHARS} chars)`);
    if (FULLTEXT_ENABLED) {
      console.error(`[Config] fulltext=${FULLTEXT_MODE}`);
    }
  });
}
