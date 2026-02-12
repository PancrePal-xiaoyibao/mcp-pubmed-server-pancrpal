import express from "express";
import { randomUUID } from "node:crypto";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
  isInitializeRequest,
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const port = Number.parseInt(process.env.PORT ?? "8745", 10);
const host = process.env.HOST ?? "0.0.0.0";

function truncate(value, maxLen = 200) {
  if (typeof value !== "string") return value;
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen)}…(len=${value.length})`;
}

function logMcpRequestBody(body) {
  const requests = Array.isArray(body) ? body : [body];
  for (const req of requests) {
    if (!req || typeof req !== "object") continue;
    if (req.method === "initialize") {
      const clientName = req.params?.clientInfo?.name;
      const clientVersion = req.params?.clientInfo?.version;
      console.log(`[mcp] initialize client=${String(clientName ?? "")}@${String(clientVersion ?? "")}`);
      continue;
    }
    if (req.method === "tools/call") {
      const toolName = req.params?.name;
      const args = req.params?.arguments;
      const query =
        (args && typeof args === "object" && (args.query ?? args.q ?? args.term ?? args.text)) || undefined;
      console.log(
        `[mcp] tools/call name=${String(toolName ?? "")} query=${typeof query === "string" ? truncate(query) : ""}`,
      );
    }
  }
}

async function safeClose(closable) {
  if (!closable) return;
  if (typeof closable.close === "function") {
    await closable.close();
    return;
  }
  if (typeof closable.dispose === "function") {
    await closable.dispose();
  }
}

async function createUpstreamClient() {
  const transport = new StdioClientTransport({
    command: "sh",
    args: ["-lc", "node /app/src/index.js --mode=stdio"],
  });

  const client = new Client({ name: "pubmed-upstream-client", version: "1.0.0" });
  await client.connect(transport);

  return { client, transport };
}

function createProxyServer(upstreamClient) {
  const server = new Server(
    { name: "pubmed-mcp-streamable-http-gateway", version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return upstreamClient.listTools();
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return upstreamClient.callTool(request.params);
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return upstreamClient.listResources(request.params ?? {});
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return upstreamClient.readResource(request.params);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    return upstreamClient.listPrompts(request.params ?? {});
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return upstreamClient.getPrompt(request.params);
  });

  return server;
}

const sessions = new Map();

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use((req, _res, next) => {
  const sessionId = req.headers["mcp-session-id"];
  const sessionSuffix = typeof sessionId === "string" ? ` session=${sessionId}` : "";
  console.log(`[http] ${req.method} ${req.path}${sessionSuffix}`);
  if (req.method === "POST" && req.path === "/mcp") logMcpRequestBody(req.body);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", mode: "streamableHttp", sessions: sessions.size });
});

async function getSessionFromRequest(req) {
  const sessionId = req.headers["mcp-session-id"];
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  return sessions.get(sessionId) ?? null;
}

app.post("/mcp", async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (session) {
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      error: "No active session. Send an initialize request first.",
    });
    return;
  }

  const upstream = await createUpstreamClient();
  const server = createProxyServer(upstream.client);

  let sessionId = null;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: async (newSessionId) => {
      sessionId = newSessionId;
      sessions.set(newSessionId, { transport, server, upstream });
    },
  });

  transport.onclose = async () => {
    if (sessionId) sessions.delete(sessionId);
    await safeClose(upstream?.client);
    await safeClose(upstream?.transport);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(400).send("Invalid or missing MCP session ID");
    return;
  }
  await session.transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const session = await getSessionFromRequest(req);
  if (!session) {
    res.status(400).send("Invalid or missing MCP session ID");
    return;
  }
  await session.transport.handleRequest(req, res);
});

app.listen(port, host, () => {
  console.log(`[streamableHttp] listening on http://${host}:${port}/mcp`);
});

