import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import http from 'http';
import { URL } from 'url';
import {
    PORT, ABSTRACT_MODE, ABSTRACT_MAX_CHARS, ABSTRACT_MODE_NOTE,
    FULLTEXT_MODE, FULLTEXT_ENABLED, FULLTEXT_AUTO_DOWNLOAD
} from '../config.js';

export async function startSSE(setupRequestHandlers) {
    const sessions = new Map();

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
        setupRequestHandlers(newServer);
        return newServer;
    };

    const httpServer = http.createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;

        // 处理CORS
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

            const sessionServer = createServerInstance();

            transport.onclose = () => {
                const sessionId = transport.sessionId;
                sessions.delete(sessionId);
                console.error(`[SSE] Session ${sessionId} closed`);
            };

            transport.onerror = (error) => {
                console.error(`[SSE] Transport error:`, error);
            };

            await sessionServer.connect(transport);

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
