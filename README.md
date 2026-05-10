# PubMed MCP Server v3.0

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/mcp-pubmed-server.svg)](https://www.npmjs.com/package/mcp-pubmed-server)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-orange)](https://modelcontextprotocol.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)](https://www.typescriptlang.org/)

为 LLM Agent 提供结构化 PubMed 文献数据的 MCP 服务器。**Agent 友好的响应模型**，专注数据提供，分析交给 LLM。

```
LLM Agent <--MCP--> PubMed MCP Server <--API--> PubMed / PMC / Unpaywall
```

**核心能力：** 文献搜索 / 智能缓存 / OA 全文下载 / Agentic 响应模型

---

## 快速开始

**前置要求：** Node.js v18.0.0+

### 1. 安装

```bash
# npm 全局安装
npm install -g mcp-pubmed-server

# 或从源码构建
git clone git@github.com:PancrePal-xiaoyibao/mcp-pubmed-server-pancrpal.git
cd mcp-pubmed-server-pancrpal
npm install && npm run build
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
PUBMED_API_KEY=你的NCBI_API密钥    # 可选，https://www.ncbi.nlm.nih.gov/account/settings/
PUBMED_EMAIL=你的邮箱               # 可选（建议填写）
ABSTRACT_MODE=quick                 # quick(1500字符) | deep(6000字符)
FULLTEXT_MODE=disabled              # disabled | enabled | auto
```

> **说明：** API Key 和 Email 均非必填。无 Key 时匿名运行（3 次/秒），有 Key 时 10 次/秒。

### 3. 运行

```bash
# npm 包
mcp-pubmed-server
# 或
npx mcp-pubmed-server

# 源码开发
npm run dev

# 源码生产
npm run build && npm start
```

---

## 传输模式

| 模式 | 适用场景 | 启动方式 |
|------|----------|----------|
| **stdio** | 本地 MCP 客户端集成 | `npm start`（默认） |
| **Streamable HTTP** | 服务端远程部署 | `npm run start:http` |

### stdio 模式（默认）

```bash
npm start
# 或
node dist/index.js --mode=stdio
```

### Streamable HTTP 模式

```bash
npm run start:http
# 或
node dist/index.js --mode=streamableHttp
```

**Docker 部署：**

```bash
cd docker
cp .env.example .env   # 编辑填入配置
docker compose up -d --build
```

**验证：**
```bash
curl http://localhost:8745/health
# {"status":"ok","mode":"streamableHttp","sessions":0}
```

**端点：**
- `POST /mcp` — MCP 协议消息
- `GET /mcp` — SSE 事件流
- `DELETE /mcp` — 关闭会话
- `GET /health` — 健康检查

---

## MCP 客户端配置

### Claude Desktop / Claude Code / Cline

```json
{
  "mcpServers": {
    "pubmed": {
      "command": "npx",
      "args": ["-y", "mcp-pubmed-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥（可选）",
        "PUBMED_EMAIL": "你的邮箱（可选）",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

配置文件位置：
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- **Claude Code**: `~/.claude/config.json`
- **Cline**: VS Code 设置中的 MCP Servers

### Cherry Studio

**stdio 模式：** 同上配置，`type` 设为 `stdio`

**streamableHttp 模式：** `type` 设为 `streamableHttp`，`baseUrl` 设为 `http://<服务器IP>:8745/mcp`

---

## 工具列表（8 个）

### 文献搜索

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_search` | 文献搜索，支持 Boolean/MeSH | `query`, `max_results`, `days_back`, `sort_by`, `format` |
| `pubmed_get_details` | 获取 PMID 完整信息（单个或批量） | `pmids`, `format` |
| `pubmed_extract_info` | 提取论文关键信息段落 | `pmid`, `sections` |
| `pubmed_find_related` | 查找相关/综述文献 | `pmid`, `type`, `max_results` |

### 缓存管理

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_manage_cache` | 缓存统计、清理、清空 | `action`, `target` |

### 全文下载（需 `FULLTEXT_MODE=enabled`）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_detect_fulltext` | 检测 OA 状态和全文可用性 | `pmid`, `auto_download` |
| `pubmed_download_fulltext` | 下载全文 PDF（单篇或批量） | `pmids`, `force` |
| `pubmed_system_status` | 系统环境和 API Key 状态检测 | 无 |

---

## Agentic 响应模型

每个工具返回统一的 `AgentResponse<T>` 结构，为 AI Agent 优化：

```json
{
  "status": "success",
  "data": { ... },
  "metadata": {
    "tool": "pubmed_search",
    "executionMs": 1234,
    "timestamp": "2025-01-01T00:00:00.000Z",
    "pagination": { "total": 500, "returned": 20, "hasMore": true }
  },
  "suggestions": [
    {
      "tool": "pubmed_get_details",
      "reason": "Get full metadata for specific articles of interest.",
      "parameters": { "pmids": ["12345678"] }
    }
  ]
}
```

- **`status`** — 成功/错误状态
- **`data`** — 类型化的返回数据
- **`metadata`** — 执行上下文（耗时、分页、缓存状态）
- **`suggestions`** — Agent 下一步操作建议（工具名 + 原因 + 参数）

---

## API Key 池配置

支持多个 NCBI API Key 轮询/主备/随机负载均衡。

在项目根目录创建 `api-keys.json`（参见 `api-keys.json.example`）：

```json
{
  "keys": [
    { "api_key": "KEY_1", "email": "user1@example.com" },
    { "api_key": "KEY_2", "email": "user2@example.com" }
  ],
  "strategy": "round-robin"
}
```

| 策略 | 说明 |
|------|------|
| `round-robin` | 轮询（默认） |
| `failover` | 主备切换 |
| `random` | 随机负载均衡 |

> **优先级：** `api-keys.json` > 环境变量 > 匿名模式
>
> **健康管理：** 连续 3 次失败自动下线，60 秒冷却后恢复

---

## 项目结构

```
src/
├── index.ts                  # 入口点
├── config.ts                 # 配置常量 + 环境变量
├── server.ts                 # MCP Server 编排器
├── types/                    # TypeScript 类型定义
│   ├── article.ts            # Article, SearchResult, OAInfo
│   ├── responses.ts          # AgentResponse<T>, makeResponse/makeError
│   └── index.ts
├── api/
│   ├── pubmed-client.ts      # PubMed EUtilities 客户端
│   └── key-pool.ts           # API Key 号池（轮询/主备/随机）
├── cache/
│   ├── memory-cache.ts       # 内存 LRU 缓存（5 分钟，100 条上限）
│   └── file-cache.ts         # 文件持久化缓存（30 天过期）
├── services/
│   ├── fulltext.ts           # OA 检测 + PDF 下载
│   └── system.ts             # 系统环境检测
├── tools/
│   ├── definitions.ts        # MCP 工具 Schema（8 个工具）
│   └── handlers.ts           # 工具路由 + 处理逻辑
├── transport/
│   ├── stdio.ts              # stdio 传输
│   └── streamable-http.ts    # HTTP 传输（Express）
└── utils/
    └── formatter.ts          # 文章格式化（compact/standard/detailed）
```

---

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 依赖缺失 | `npm install && npm run build` |
| PubMed API 调用失败 | 检查网络；有 Key 时确认 Key 有效 |
| Key 池全部不可用 | 检查 `api-keys.json` 中 Key 是否有效，60 秒后自动恢复 |
| 端口被占用 | `lsof -i :8745` 查看，或设置 `PORT=其他端口` |
| Docker 健康检查失败 | 检查 `.env` 配置，`docker logs pubmed-mcp` |

---

## 许可证

MIT License
