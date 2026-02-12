import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import {
    PORT, ABSTRACT_MODE, ABSTRACT_MAX_CHARS, ABSTRACT_MODE_NOTE,
    FULLTEXT_MODE, FULLTEXT_ENABLED, FULLTEXT_AUTO_DOWNLOAD
} from '../config.js';

export async function startStreamableHttp(setupRequestHandlers) {
    const sessions = new Map();

    const createServerInstance = () => {
        const newServer = new Server(
            { name: "pubmed-data-server", version: "2.0.0" },
            { capabilities: { tools: {} } }
        );
        setupRequestHandlers(newServer);
        return newServer;
    };

    const app = express();
    app.use(express.json({ limit: '10mb' }));

    // CORS
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, MCP-Session-Id, MCP-Protocol-Version');
        res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');
        if (req.method === 'OPTIONS') {
            res.writeHead(200).end();
            return;
        }
        next();
    });

    // Health check
    app.get('/health', (_req, res) => {
        res.json({ status: 'ok', mode: 'streamableHttp', sessions: sessions.size });
    });

    // MCP endpoint - POST
    app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        if (sessionId && sessions.has(sessionId)) {
            const session = sessions.get(sessionId);
            await session.transport.handleRequest(req, res, req.body);
            return;
        }

        if (!isInitializeRequest(req.body)) {
            res.status(400).json({
                error: 'No active session. Send an initialize request first.'
            });
            return;
        }

        const server = createServerInstance();
        let newSessionId = null;
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: async (id) => {
                newSessionId = id;
                sessions.set(id, { transport, server });
                console.error(`[StreamableHTTP] New session established: ${id}`);
            }
        });

        transport.onclose = async () => {
            if (newSessionId) {
                sessions.delete(newSessionId);
                console.error(`[StreamableHTTP] Session ${newSessionId} closed`);
            }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    // MCP endpoint - GET (SSE stream for server-initiated messages)
    app.get('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        const session = sessionId && sessions.get(sessionId);
        if (!session) {
            res.status(400).send('Invalid or missing MCP session ID');
            return;
        }
        await session.transport.handleRequest(req, res);
    });

    // MCP endpoint - DELETE (session termination)
    app.delete('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'];
        const session = sessionId && sessions.get(sessionId);
        if (!session) {
            res.status(400).send('Invalid or missing MCP session ID');
            return;
        }
        await session.transport.handleRequest(req, res);
    });

    app.listen(PORT, () => {
        console.error("PubMed Data Server v2.0 running on Streamable HTTP");
        console.error(`[StreamableHTTP] Server listening on http://0.0.0.0:${PORT}`);
        console.error(`[StreamableHTTP] MCP endpoint: http://0.0.0.0:${PORT}/mcp`);
        console.error(`[StreamableHTTP] Health check: http://0.0.0.0:${PORT}/health`);
        console.error(`[AbstractMode] ${ABSTRACT_MODE} (max_chars=${ABSTRACT_MAX_CHARS}) - ${ABSTRACT_MODE_NOTE}`);
        if (FULLTEXT_ENABLED) {
            console.error(`[FullTextMode] ${FULLTEXT_MODE} - ${FULLTEXT_AUTO_DOWNLOAD ? 'Auto-download enabled' : 'Manual download only'}`);
        }
    });
}
