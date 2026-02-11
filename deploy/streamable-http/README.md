# Streamable HTTP 部署（Docker，端口 8745）

本部署方式用于给 **Cherry Studio 等远程 MCP 客户端**提供 `streamableHttp` 传输：

- `POST /mcp`（首次必须是 `initialize`，返回 `Mcp-Session-Id`）
- `GET /mcp`（服务器事件流，带 `Mcp-Session-Id`）
- `DELETE /mcp`（关闭会话，带 `Mcp-Session-Id`）
- `GET /health`

## 1) 配置环境变量

```bash
cd deploy/streamable-http
cp .env.example .env
```

编辑 `deploy/streamable-http/.env`，填好 `PUBMED_API_KEY` 和 `PUBMED_EMAIL` 等配置。

## 2) 启动

```bash
cd deploy/streamable-http
docker compose up -d --build
```

## 3) 验证

```bash
curl -sS http://127.0.0.1:8745/health
```

## 4) Cherry Studio 配置

在 Cherry Studio 的 MCP Server 中新增：

- `type`: `streamableHttp`
- `baseUrl`: `http://<你的服务器IP或域名>:8745/mcp`

## 5) 反向代理（可选）

如果你用 Nginx/Caddy 反代，需要禁用缓冲（否则会影响流式传输）。

Nginx 示例：

```nginx
location / {
  proxy_pass http://127.0.0.1:8745;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_read_timeout 3600;
  proxy_send_timeout 3600;
  proxy_buffering off;
  add_header X-Accel-Buffering no;
}
```

