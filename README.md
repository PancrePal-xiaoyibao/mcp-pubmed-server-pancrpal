```
██████╗ ██╗   ██╗██████╗ ███╗   ███╗███████╗██████╗     ██████╗  █████╗ ████████╗ █████╗
██╔══██╗██║   ██║██╔══██╗████╗ ████║██╔════╝██╔══██╗   ██╔════╝ ██╔══██╗╚══██╔══╝██╔══██╗
██████╔╝██║   ██║██████╔╝██╔████╔██║█████╗  ██║  ██║   ██║  ███╗███████║   ██║   ███████║
██╔═══╝ ██║   ██║██╔══██╗██║╚██╔╝██║██╔══╝  ██║  ██║   ██║   ██║██╔══██║   ██║   ██╔══██║
██║     ╚██████╔╝██████╔╝██║ ╚═╝ ██║███████╗██████╔╝   ╚██████╔╝██║  ██║   ██║   ██║  ██║
╚═╝      ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚══════╝╚═════╝     ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝
```

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/mcp-pubmed-llm-server.svg)](https://www.npmjs.com/package/mcp-pubmed-llm-server)
[![npm downloads](https://img.shields.io/npm/dm/mcp-pubmed-llm-server.svg)](https://www.npmjs.com/package/mcp-pubmed-llm-server)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-orange)](https://modelcontextprotocol.io/)
[![PubMed API](https://img.shields.io/badge/PubMed-API-blue)](https://www.ncbi.nlm.nih.gov/books/NBK25501/)

# PubMed Data Server v2.0

为 LLM 提供结构化 PubMed 文献数据的 MCP 服务器。专注数据提供，分析交给 LLM。

```
用户客户端(LLM) ←→ MCP服务器(数据获取+结构化) ←→ PubMed API
```

**核心能力：** 文献搜索 / 智能缓存 / OA 全文下载 / EndNote 导出（RIS + BibTeX）

---

## 快速开始

**前置要求：** Node.js v18.0.0+

### 1. 安装

```bash
# npm 全局安装（推荐）
npm install -g mcp-pubmed-llm-server

# 或从源码安装
git clone git@github.com:PancrePal-xiaoyibao/mcp-pubmed-server-pancrpal.git
cd mcp-pubmed-server-pancrpal && npm install
```

### 2. 配置 API 密钥

```bash
cp .env.example .env
```

编辑 `.env`，填入配置：

```env
PUBMED_API_KEY=你的NCBI_API密钥    # 可选，https://www.ncbi.nlm.nih.gov/account/settings/
PUBMED_EMAIL=你的邮箱地址            # 可选（建议填写）
```

> **说明：** API Key 和 Email 均非必填。无 Key 时以匿名模式运行（限速 3 次/秒），有 Key 时提升至 10 次/秒。

**多 API Key 池（可选）：** 支持多个 Key 轮询/主备/随机负载均衡，参见下方 [API Key 池配置](#api-key-池配置) 章节。

可选配置：

```env
ABSTRACT_MODE=quick       # quick(1500字符) | deep(6000字符)
FULLTEXT_MODE=disabled    # disabled | enabled | auto
ENDNOTE_EXPORT=enabled    # enabled | disabled
```

### 3. 运行

```bash
# npm 包
mcp-pubmed-llm-server
# 或
npx mcp-pubmed-llm-server

# 源码
node src/index.js
```

---

## 传输模式

服务器支持两种传输模式，适用于不同场景：

| 模式 | 适用场景 | 启动方式 |
|------|----------|----------|
| **stdio** | 本地 MCP 客户端集成 | `node src/index.js` (默认) |
| **Streamable HTTP** | 服务端远程部署 | `node src/index.js --mode=streamableHttp` |

### stdio 模式（默认）

通过标准输入输出与 MCP 客户端通信，无需配置端口。

```bash
node src/index.js --mode=stdio
# 或
npm run start:stdio
```

### Streamable HTTP 模式（服务端部署）

MCP 2025-11-25 规范推荐的 HTTP 传输方式，统一的 `/mcp` 端点 + 会话管理。适用于 Cherry Studio 等远程 MCP 客户端。默认端口 `8745`。

**方式一：直接运行**

```bash
node src/index.js --mode=streamableHttp
# 或
npm run start:streamableHttp
```

**方式二：Docker 部署**

```bash
cd docker
cp .env.example .env
# 编辑 .env，填入 PUBMED_API_KEY 和 PUBMED_EMAIL（均为可选）

docker compose up -d --build
```

**验证：**
```bash
curl http://localhost:8745/health
# {"status":"ok","mode":"streamableHttp","sessions":0}
```

**端点：**
- `POST /mcp` — JSON-RPC（首次必须为 `initialize`，返回 `Mcp-Session-Id`）
- `GET /mcp` — 服务器事件流（带 `Mcp-Session-Id`）
- `DELETE /mcp` — 关闭会话
- `GET /health` — 健康检查

**反向代理（Nginx 示例）：**
```nginx
location / {
    proxy_pass http://127.0.0.1:8745;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_read_timeout 3600;
    proxy_send_timeout 3600;
    proxy_buffering off;              # 必须禁用缓冲
    add_header X-Accel-Buffering no;
}
```

**生产环境建议：**
- 使用进程管理器（PM2、systemd）确保持续运行
- 配置 HTTPS 反向代理
- 设置防火墙规则，仅开放必要端口

---

## MCP 客户端配置

### Cline / Claude Desktop / Claude Code

**stdio 模式（本地运行）：**

```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥（可选）",
        "PUBMED_EMAIL": "你的邮箱地址（可选）",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

> **说明：** `PUBMED_API_KEY` 和 `PUBMED_EMAIL` 均为可选。不填则以匿名模式运行（限速 3 次/秒），填写后提升至 10 次/秒。如需多 Key 池，参见 [API Key 池配置](#api-key-池配置)。

配置文件位置：
- **Cline**: VS Code 设置中的 MCP Servers 配置
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 或 `%APPDATA%/Claude/claude_desktop_config.json` (Windows)
- **Claude Code**: `~/.claude/config.json`

> 也可使用 `"command": "mcp-pubmed-llm-server"`（全局安装后）或 `"command": "node", "args": ["/path/to/src/index.js"]`（源码安装）。

### Cherry Studio

**stdio 模式：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "name": "pubmed-data-server",
      "type": "stdio",
      "isActive": true,
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥（可选）",
        "PUBMED_EMAIL": "你的邮箱地址（可选）"
      }
    }
  }
}
```

**streamableHttp 模式（远程部署）：**
- type: `streamableHttp`
- baseUrl: `http://<服务器IP>:8745/mcp`

> Cherry Studio 不支持 `cwd` 参数。Windows 路径使用正斜杠 `/` 或双反斜杠 `\\`。

---

## 工具列表

共 13 个 MCP 工具：

### 文献搜索

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_search` | 高级文献搜索 | `query`, `max_results`, `days_back`, `sort_by` |
| `pubmed_quick_search` | 快速搜索（精简结果） | `query`, `max_results` |
| `pubmed_get_details` | 获取 PMID 完整信息 | `pmids`, `include_full_text` |
| `pubmed_extract_key_info` | 提取论文关键信息 | `pmid`, `extract_sections` |
| `pubmed_cross_reference` | 交叉引用分析 | `pmid`, `reference_type` |
| `pubmed_batch_query` | 批量查询（最多 20 个 PMID） | `pmids`, `query_format` |

### 缓存管理

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_cache_info` | 缓存统计和管理 | `action`: stats / clear / clean |

### 全文下载（需 `FULLTEXT_MODE=enabled`）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_detect_fulltext` | 检测 OA 状态和全文可用性 | `pmid`, `auto_download` |
| `pubmed_download_fulltext` | 下载单篇全文 PDF | `pmid`, `force_download` |
| `pubmed_fulltext_status` | 全文缓存管理 | `action`: stats / list / clean / clear |
| `pubmed_batch_download` | 批量下载（最多 10 篇） | `pmids`, `human_like` |
| `pubmed_system_check` | 系统环境和下载工具检测 | 无 |

### EndNote 导出（需 `ENDNOTE_EXPORT=enabled`）

| 工具 | 说明 | 关键参数 |
|------|------|----------|
| `pubmed_endnote_status` | 导出管理和统计 | `action`: stats / list / clean / clear |

---

## API Key 池配置

支持多个 NCBI API Key 的轮询、主备切换和随机负载均衡，提高并发能力和容错性。

### 配置方式

**方式一：`api-keys.json` 文件（多 Key，推荐）**

在项目根目录创建 `api-keys.json`（参见 `api-keys.json.example`）：

```json
{
  "keys": [
    {
      "api_key": "你的第一个NCBI_API密钥",
      "email": "user1@example.com"
    },
    {
      "api_key": "你的第二个NCBI_API密钥",
      "email": "user2@example.com"
    }
  ],
  "strategy": "round-robin"
}
```

**方式二：环境变量（单 Key，向后兼容）**

```env
PUBMED_API_KEY=你的NCBI_API密钥
PUBMED_EMAIL=你的邮箱地址
```

**方式三：无 Key（匿名模式）**

不配置任何 Key，以匿名模式运行（限速 3 次/秒）。

> **优先级：** `api-keys.json` > 环境变量 > 匿名模式

### Key 选择策略

| 策略 | 说明 |
|------|------|
| `round-robin` | 轮询（默认），每次请求依次选用下一个 Key |
| `failover` | 主备切换，优先使用第一个 Key，失败时切换到下一个 |
| `random` | 随机选择，均匀分散请求 |

### 健康管理

- 连续 3 次失败自动标记为不可用
- 60 秒冷却后自动恢复
- 所有 Key 不可用时强制恢复最早失败的 Key
- 通过 `pubmed_system_check` 工具可查看 Key 池状态

---

## 项目结构

```
mcp-pubmed-server/
├── src/
│   ├── index.js                # 入口点
│   ├── config.js               # 配置常量
│   ├── server.js               # 主编排器
│   ├── api/
│   │   ├── pubmed-client.js    # PubMed API 客户端
│   │   └── key-pool.js         # API Key 号池管理器
│   ├── cache/
│   │   ├── memory-cache.js     # 内存 LRU 缓存
│   │   └── file-cache.js       # 文件持久化缓存
│   ├── services/
│   │   ├── fulltext.js         # OA 检测 + PDF 下载
│   │   ├── endnote.js          # RIS / BibTeX 导出
│   │   └── system.js           # 系统环境检测
│   ├── tools/
│   │   ├── definitions.js      # 工具 schema 定义
│   │   └── handlers.js         # 工具调用路由
│   ├── transport/
│   │   ├── stdio.js            # stdio 传输
│   │   └── streamable-http.js  # Streamable HTTP 传输
│   └── utils/
│       └── formatter.js        # LLM 格式化
├── docker/                     # Docker 部署
│   ├── Dockerfile
│   ├── docker-compose.yml
│   └── .env.example
├── docs/
│   ├── FULLTEXT_SMART_DOWNLOAD.md
│   ├── ENDNOTE_EXPORT.md
│   └── GITHUB_ACTIONS_PUBLISH.md
├── api-keys.json.example       # 多 Key 池配置模板
├── .env.example
├── package.json
├── LICENSE
└── README.md
```

---

## 故障排除

| 问题 | 解决方案 |
|------|----------|
| 找不到 `@modelcontextprotocol/sdk` | `npm install -g mcp-pubmed-llm-server` 或 `npm install` |
| PubMed API 调用失败 | 检查网络连接；有 Key 时确认 Key 有效，无 Key 时等待速率限制重置（3 次/秒） |
| 环境变量未生效 | 确认 `.env` 文件存在且变量名正确 |
| Key 池全部不可用 | 检查 `api-keys.json` 中的 Key 是否有效；60 秒后会自动恢复 |
| 端口被占用 | `lsof -i :8745` (macOS/Linux) 或 `netstat -ano \| findstr :8745` (Windows)，或改用 `PORT=其他端口` 启动 |
| Docker 健康检查失败 | 检查 `.env` 配置，查看 `docker logs pubmed-mcp` |

---

## npm 包

- **包名**: [mcp-pubmed-llm-server](https://www.npmjs.com/package/mcp-pubmed-llm-server)
- **安装**: `npm install -g mcp-pubmed-llm-server`
- **使用**: `npx mcp-pubmed-llm-server` 或 `mcp-pubmed-llm-server`

## 详细文档

- [全文下载与智能下载系统](docs/FULLTEXT_SMART_DOWNLOAD.md)
- [EndNote 导出功能](docs/ENDNOTE_EXPORT.md)
- [GitHub Actions 自动发布](docs/GITHUB_ACTIONS_PUBLISH.md)

## 许可证

Apache License 2.0
