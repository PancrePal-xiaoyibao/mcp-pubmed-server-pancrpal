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
[![EndNote Export](https://img.shields.io/badge/EndNote-Export-green)](docs/ENDNOTE_EXPORT.md)

# 🧬 PubMed Data Server v2.0

**🔬 极简架构，专注数据提供** - 为LLM提供结构化的PubMed文献数据

---

## 🎯 核心功能

> **四大核心功能，满足学术研究的全方位需求**

### 📚 **论文索引搜索** - 智能文献检索
- **关键词搜索**：支持复杂查询语法，精准定位相关文献
- **批量查询**：一次获取多篇论文的详细信息  
- **交叉引用**：发现相关研究，构建知识网络
- **事实核查**：验证研究结论，提供证据支持

### 💾 **智能缓存系统** - 高效数据管理
- **本地缓存**：避免重复API调用，提升响应速度
- **缓存统计**：实时监控缓存状态和存储使用情况
- **智能更新**：自动检测数据变化，保持缓存新鲜度
- **存储优化**：压缩存储，节省磁盘空间

### 📄 **OA论文全文下载** - 开放获取文献获取
- **全文检测**：自动识别可下载的开放获取论文
- **智能下载**：模拟人类行为，避免被反爬虫机制拦截
- **批量处理**：支持大量论文的批量下载和管理
- **格式支持**：PDF格式，便于阅读和引用

### 📋 **EndNote格式导出** - 文献管理集成
- **RIS格式**：兼容EndNote、Zotero等主流文献管理软件
- **BibTeX格式**：支持LaTeX写作和学术引用
- **自动导出**：查询结果自动生成引用文件
- **批量处理**：支持大量文献的批量导出

---

## 🎯 核心理念

**MCP服务器 = 数据提供者，外部LLM = 智能分析**

```
用户客户端(LLM) ←→ MCP服务器(PubMed数据) ←→ PubMed API
     ↑                      ↑
  智能分析              数据获取+结构化
```

**核心优势：**
- ✅ **极简配置**：只需PubMed API和邮箱
- ✅ **LLM友好**：结构化输出，优化上下文窗口
- ✅ **高效检索**：批量查询、交叉引用、事实核查

---

## 🚀 快速部署

> **💡 新功能：支持SSE模式云端部署！** 现在可以通过 `npm run start:sse` 启动SSE服务器，支持远程访问和多客户端并发连接。详见[云端部署指南](#☁️-云端部署指南)

### 前置要求
安装Node.js (v22.0.0+ LTS)：[nodejs.org](https://nodejs.org/)

### 方式一：使用 npm 安装（推荐）

通过 npm 全局安装或本地安装：

```bash
# 全局安装
npm install -g mcp-pubmed-llm-server

# 或本地安装
npm install mcp-pubmed-llm-server
```

安装后，可以通过以下方式使用：

```bash
# 全局安装后直接运行
mcp-pubmed-llm-server

# 或本地安装后使用 npx
npx mcp-pubmed-llm-server
```

### 方式二：从源码安装

如果你想从源码安装或贡献代码：

```bash
# 克隆仓库
git clone git@github.com:PancrePal-xiaoyibao/mcp-pubmed-server-pancrpal.git mcp-pubmed-server
cd mcp-pubmed-server

# 安装依赖
npm install
```

### 步骤三：配置API密钥
```bash
cp .env.example .env
# 编辑.env文件，填入以下内容：
```

```env
PUBMED_API_KEY=你的NCBI_API密钥
PUBMED_EMAIL=你的邮箱地址
```

**获取API密钥：**
1. 访问 [NCBI API Key Management](https://www.ncbi.nlm.nih.gov/account/settings/)
2. 登录NCBI账户，生成API密钥

### 步骤四：运行模式选择

服务器支持两种运行模式：

#### **stdio 模式（默认）** - 本地开发推荐
适用于本地开发、MCP客户端集成（如Claude Desktop、Cline等）

```bash
# 方式一：使用npm脚本
npm run start:stdio

# 方式二：直接运行
node src/index.js --mode=stdio

# 方式三：默认模式（不指定参数时自动使用stdio）
node src/index.js
```

**特点：**
- ✅ 通过标准输入输出与MCP客户端通信
- ✅ 适合本地开发和MCP客户端集成
- ✅ 无需配置端口，开箱即用

#### **SSE 模式** - 云端部署推荐
适用于云端部署、远程访问、多客户端并发访问

```bash
# 使用npm脚本启动
npm run start:sse

# 或直接运行
node src/index.js --mode=sse

# 指定端口（默认3000）
PORT=8080 node src/index.js --mode=sse
```

**特点：**
- ✅ 基于HTTP Server-Sent Events (SSE) 协议
- ✅ 支持远程访问和云端部署
- ✅ 支持多客户端并发连接
- ✅ 提供健康检查端点

**SSE模式端点：**
- `GET /sse` - 建立SSE连接
- `POST /message` - 接收客户端消息（需要sessionId参数）
- `GET /health` - 健康检查端点

**环境变量配置：**
```env
# SSE模式端口配置（可选，默认3000）
PORT=3000

# 或通过命令行参数指定模式
# --mode=stdio 或 --mode=sse
# 或通过环境变量 MCP_TRANSPORT=stdio 或 MCP_TRANSPORT=sse
```

### 步骤五：测试服务器

**测试stdio模式：**
```bash
npm run start:stdio
# 看到 "PubMed Data Server v2.0 running on stdio" 表示成功
```

**测试SSE模式：**
```bash
npm run start:sse
# 看到以下信息表示成功：
# "PubMed Data Server v2.0 running on SSE"
# "[SSE] Server listening on http://0.0.0.0:3000"
# "[SSE] SSE endpoint: http://0.0.0.0:3000/sse"
# "[SSE] Message endpoint: http://0.0.0.0:3000/message"
# "[SSE] Health check: http://0.0.0.0:3000/health"
```

**验证SSE模式健康检查：**
```bash
curl http://localhost:3000/health
# 应返回：{"status":"ok","mode":"sse","sessions":0}
```

> 环境变量说明：项目已内置 `.env` 自动加载（使用 dotenv）。在项目根目录创建 `.env`，例如：

```env
PUBMED_API_KEY=你的NCBI_API密钥
PUBMED_EMAIL=你的邮箱地址
# 摘要截断模式：quick | deep
# quick：1500 字符（快速检索，可能不包含完整摘要）
# deep：6000 字符（深度检索；建议模型上下文窗口 ≥ 120k tokens）
ABSTRACT_MODE=quick
# 全文模式：disabled | enabled | auto
# disabled：禁用全文功能（默认）
# enabled：启用全文检测，手动下载
# auto：启用全文检测，自动下载可用的OA论文
FULLTEXT_MODE=disabled
# EndNote导出：enabled | disabled
# enabled：自动导出RIS和BibTeX格式（默认）
# disabled：禁用EndNote导出
ENDNOTE_EXPORT=enabled
# SSE模式端口配置（仅SSE模式需要，默认3000）
PORT=3000
# 传输模式选择（可选，默认stdio）
# 可通过命令行参数 --mode=stdio 或 --mode=sse 覆盖
MCP_TRANSPORT=stdio
```

### 步骤六：MCP客户端配置

#### 1. Cline (VS Code Extension) 配置

**使用 npm 包（推荐）：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或使用全局安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "mcp-pubmed-llm-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或从源码安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "node",
      "args": ["./src/index.js"],
      "cwd": "完整路径/to/mcp-pubmed-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**路径示例：**
- **Linux/macOS**: `/home/user/mcp-pubmed-server`
- **Windows**: `C:/Users/YourUser/mcp-pubmed-server`

#### 2. Cherry Studio (Windows) 配置

**使用 npm 包（推荐）：**
```json
{
  "mcpServers": {
    "VBFfGqCFz9AuZJXX2f5GL": {
      "name": "pubmed-data-server",
      "type": "stdio",
      "isActive": true,
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或使用全局安装：**
```json
{
  "mcpServers": {
    "VBFfGqCFz9AuZJXX2f5GL": {
      "name": "pubmed-data-server",
      "type": "stdio",
      "isActive": true,
      "command": "mcp-pubmed-llm-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或从源码安装：**
```json
{
  "mcpServers": {
    "VBFfGqCFz9AuZJXX2f5GL": {
      "name": "pubmed-data-server",
      "type": "stdio",
      "isActive": true,
      "command": "node",
      "args": [
        "Y:/software/mcp-pubmed-server/src/index.js"
      ],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**Windows 网络映射配置说明：**
- npm 包方式最简单，无需配置路径
- 也可以使用本地路径如 `C:/mcp-pubmed-server/src/index.js`
- **注意**: Cherry Studio 不支持 `cwd` 参数

#### 3. Claude Desktop 配置
编辑 `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) 或
`%APPDATA%/Claude/claude_desktop_config.json` (Windows):

**使用 npm 包（推荐）：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或使用全局安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "mcp-pubmed-llm-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或从源码安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "node",
      "args": ["/mnt/1T/software/mcp-pubmed-server/src/index.js"],
      "cwd": "/mnt/1T/software/mcp-pubmed-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或使用项目内置模板：**
```bash
cp config/claude_desktop_config.json.example config/claude_desktop_config.json
# 编辑配置文件，填入API密钥
```

#### 4. Claude Code (CLI) 配置
编辑 `~/.claude/config.json`:

**使用 npm 包（推荐）：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "npx",
      "args": ["-y", "mcp-pubmed-llm-server"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或使用全局安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "mcp-pubmed-llm-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

**或从源码安装：**
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "node",
      "args": ["/mnt/1T/software/mcp-pubmed-server/src/index.js"],
      "cwd": "/mnt/1T/software/mcp-pubmed-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled"
      }
    }
  }
}
```

### 步骤七：验证集成
在客户端中测试：`使用pubmed_search工具搜索"acupuncture"`

---

## ☁️ 云端部署指南

### 方法一：Docker 部署（推荐）

我们提供了完整的 Docker 部署方案，支持快速启动和数据持久化。详细说明请参考 [Docker 部署文档](docs/DOCKER_README.md)。

#### 快速开始
```bash
# 克隆仓库
git clone https://github.com/yourusername/mcp-pubmed-server-pancrpal.git
cd mcp-pubmed-server-pancrpal

# 使用 Docker Compose 启动服务
docker-compose up -d

# 服务将在 http://localhost:3000 上运行
```

### 方法二：SSE模式云端部署

SSE模式专为云端部署设计，支持远程访问和多客户端并发连接。

#### **部署步骤：**

1. **准备服务器环境**
   ```bash
   # 安装Node.js (v22.0.0+ LTS)
   # 克隆或上传项目到服务器
   git clone [项目地址]
   cd mcp-pubmed-server-pancrpal
   npm install
   ```

2. **配置环境变量**
   ```bash
   # 创建.env文件
   cp .env.example .env
   # 编辑.env，填入API密钥和邮箱
   ```

3. **启动SSE服务器**
   ```bash
   # 使用PM2等进程管理器（推荐）
   npm install -g pm2
   pm2 start npm --name "pubmed-server" -- run start:sse
   
   # 或直接运行
   PORT=3000 npm run start:sse
   ```

4. **配置防火墙和反向代理（可选）**
   ```nginx
   # Nginx配置示例
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'keep-alive';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

5. **验证部署**
   ```bash
   # 健康检查
   curl http://your-server:3000/health
   # 应返回：{"status":"ok","mode":"sse","sessions":0}
   ```

#### **使用场景对比：**

| 模式 | 适用场景 | 优势 |
|------|----------|------|
| **stdio** | 本地开发、MCP客户端集成 | 简单、无需配置端口 |
| **SSE** | 云端部署、远程访问 | 支持多客户端、可扩展 |

#### **生产环境建议：**

- ✅ 使用进程管理器（PM2、systemd等）确保服务持续运行
- ✅ 配置反向代理（Nginx、Caddy等）提供HTTPS支持
- ✅ 设置防火墙规则，仅开放必要端口
- ✅ 配置日志轮转和监控告警
- ✅ 定期更新依赖和检查安全漏洞

---

## 🛠️ 11个高效工具

### 1. `pubmed_search` - 智能文献搜索
```json
{
  "query": "acupuncture gut microbiome",
  "max_results": 20,
  "days_back": 30,
  "sort_by": "relevance"
}
```

### 2. `pubmed_get_details` - 详细信息获取
```json
{
  "pmids": ["38412345", "38412346"],
  "include_full_text": true
}
```

### 3. `pubmed_extract_key_info` - 关键信息提取
```json
{
  "pmid": "38412345",
  "extract_sections": ["basic_info", "abstract_summary", "authors", "keywords"],
  "max_abstract_length": 2000
}
```

### 4. `pubmed_cross_reference` - 交叉引用分析
```json
{
  "pmid": "38412345",
  "reference_type": "similar",
  "max_results": 10
}
```

### 5. `pubmed_batch_query` - 批量查询优化
```json
{
  "pmids": ["38412345", "38412346", "38412347"],
  "query_format": "llm_optimized",
  "include_abstracts": true
}
```

### 6. `pubmed_detect_fulltext` - 检测全文可用性
```json
{
  "pmid": "38412345",
  "auto_download": false
}
```

### 7. `pubmed_download_fulltext` - 下载全文PDF
```json
{
  "pmid": "38412345",
  "force_download": false
}
```

### 8. `pubmed_fulltext_status` - 全文缓存管理
```json
{
  "action": "stats",
  "pmid": "38412345"
}
```

### 9. `pubmed_batch_download` - 批量智能下载
```json
{
  "pmids": ["38412345", "38412346", "38412347"],
  "human_like": true
}
```

### 10. `pubmed_system_check` - 系统环境检测
```json
{}
```

### 11. `pubmed_endnote_status` - EndNote导出管理
```json
{
  "action": "stats"
}
```

---

## 🏗️ 架构特色

### 📊 LLM优化输出
- **简洁格式**：标题、作者、期刊、日期
- **详细格式**：完整元数据+结构化摘要
- **LLM优化格式**：智能截断、关键点提取、关键词组织

### 🧠 上下文窗口管理
- 摘要截断模式（通过环境变量配置）：
  - QUICK 模式：1500 字符，快速检索，可能不包含完整摘要
  - DEEP 模式：6000 字符，深度检索；建议模型上下文窗口 ≥ 120k tokens（批量查询时更稳妥）
- 关键点提取（5个要点）
- 结构化信息分层

### 🔍 事实核查支持
- 交叉引用相关文献
- 相似研究对比
- 综述文献查找

### ⚡ 性能优化
- 速率限制管理（PubMed API限制）
- 批量查询优化（最多20个PMID）
- 错误重试机制

---

## 📝 使用场景

### 🔬 学术研究辅助
```
用户：我想了解针灸治疗肠易激综合征的最新研究
LLM → pubmed_search → 获取数据 → 智能分析和总结
```

### ✅ 事实核查
```
用户：这篇论文说某种化合物能治疗癌症，是真的吗？
LLM → pubmed_get_details → pubmed_cross_reference → 核查相关研究
```

### 📈 文献综述
```
用户：帮我分析某个领域的研究趋势
LLM → 批量查询 → 趋势分析 → 研究方向建议
```

### 💡 生物学问答
```
用户：某个蛋白质的功能是什么？
LLM → pubmed_search → pubmed_extract_key_info → 精准回答
```

---

## 📁 项目结构

```
mcp-pubmed-server/
├── src/
│   └── index.js              # 主服务器代码
├── config/
│   ├── mcp-config.json       # MCP配置模板
│   └── claude_desktop_config.json  # Claude Desktop配置
├── .env.example              # 环境变量模板
├── package.json              # 项目依赖配置
└── README.md                 # 本文件
```

---

## 🔍 故障排除

### 常见问题

1. **"找不到模块 @modelcontextprotocol/sdk"**
   ```bash
   # 如果使用 npm 包
   npm install -g mcp-pubmed-llm-server
   
   # 如果从源码安装
   npm install
   ```

2. **"PubMed API调用失败"**
   - 检查API密钥是否正确
   - 确认网络连接正常
   - 等待速率限制重置

3. **"环境变量未设置"**
   - 确保 `.env` 文件存在
   - 检查变量名拼写

4. **Cherry Studio配置错误**
   - 使用完整路径到 `src/index.js`
   - 不要使用 `cwd` 参数
   - 使用正斜杠 `/` 或双反斜杠 `\\`

5. **SSE模式启动失败**
   - 检查端口是否被占用：`lsof -i :3000` (macOS/Linux) 或 `netstat -ano | findstr :3000` (Windows)
   - 确认防火墙允许指定端口访问
   - 检查环境变量 `PORT` 是否正确设置
   - 验证SSE端点可访问：`curl http://localhost:3000/health`

6. **SSE模式连接问题**
   - 确保客户端支持SSE协议
   - 检查网络连接和防火墙设置
   - 验证sessionId是否正确传递
   - 查看服务器日志获取详细错误信息

### 部署清单
- [ ] Node.js已安装 (v22.0.0+ LTS)
- [ ] npm 包已安装 (`npm install -g mcp-pubmed-llm-server`) 或从源码安装 (`npm install`)
- [ ] 环境变量已配置（通过 `.env` 文件或 MCP 客户端配置）
- [ ] 服务器可正常启动
- [ ] MCP客户端配置正确

### 📦 安装方式对比

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **npm 包安装** | 简单快捷，自动更新，无需管理源码 | 需要配置环境变量 | 生产环境，推荐 |
| **源码安装** | 可自定义修改，开发调试方便 | 需要手动更新，路径配置复杂 | 开发环境，贡献代码 |

---

## 📄 许可证

Apache License 2.0

---

## 📚 详细文档

- **[全文模式与智能下载系统完整指南](docs/FULLTEXT_SMART_DOWNLOAD.md)** - 完整的全文模式和跨平台智能下载使用指南
- **[EndNote导出功能使用指南](docs/ENDNOTE_EXPORT.md)** - EndNote兼容格式自动导出功能
- **[配置说明文档](docs/CONFIGURATION.md)** - 环境变量和MCP客户端配置指南
- **[GitHub Actions 自动发布指南](docs/GITHUB_ACTIONS_PUBLISH.md)** - npm 自动发布工作流说明
- **[项目结构说明](.cursor/rules/README.md)** - Cursor规则和项目架构说明

---

## 📦 npm 包信息

- **包名**: [mcp-pubmed-llm-server](https://www.npmjs.com/package/mcp-pubmed-llm-server)
- **安装**: `npm install -g mcp-pubmed-llm-server`
- **使用**: `npx mcp-pubmed-llm-server` 或 `mcp-pubmed-llm-server`

---

**🎉 简单、高效、专注 - 现代MCP服务标准**

*版本 2.0 - 简化架构，专注数据提供*
