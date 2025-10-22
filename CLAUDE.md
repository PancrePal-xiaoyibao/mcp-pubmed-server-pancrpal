# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个 PubMed 数据服务器 (MCP Server)，为 LLM 提供结构化的生物医学文献检索和分析功能。项目采用极简架构，专注于数据提供而非智能分析。

## 常用开发命令

### 基础命令
```bash
# 安装依赖
npm install

# 开发模式运行（支持文件监听和自动重启）
npm run dev

# 生产模式运行
npm start

# 运行测试
npm test

# 初始化项目（安装依赖并创建.env文件）
npm run setup
```

### 环境配置
```bash
# 复制环境变量模板
cp .env.example .env

# 编辑环境变量
# PUBMED_API_KEY=你的NCBI_API密钥
# PUBMED_EMAIL=你的邮箱地址
# ABSTRACT_MODE=quick|deep
```

## 核心架构

### 主要组件
- **src/index.js**: 主服务器文件，包含所有 MCP 工具的实现
- **缓存系统**:
  - 内存缓存：临时存储搜索结果（LRU策略）
  - 文件缓存：持久化存储单篇论文详情（30天过期）
- **配置文件**:
  - `config/mcp-config.json`: MCP服务器配置模板
  - `config/claude_desktop_config.json`: Claude Desktop配置示例

### MCP 工具集合
1. **pubmed_search**: 主要文献搜索工具，支持高级参数
2. **pubmed_quick_search**: 快速搜索，返回精简结果
3. **pubmed_get_details**: 获取指定PMID的完整信息
4. **pubmed_extract_key_info**: 提取论文关键信息
5. **pubmed_cross_reference**: 交叉引用相关文献
6. **pubmed_batch_query**: 批量查询多个PMID
7. **pubmed_cache_info**: 缓存管理和统计

### 关键配置参数
- **ABSTRACT_MODE**: 控制摘要长度（quick: 1500字符, deep: 6000字符）
- **速率限制**: 334ms间隔（PubMed API限制：每秒3次请求）
- **缓存策略**: 内存缓存5分钟过期，文件缓存30天过期

## 开发注意事项

### PubMed API 集成
- 使用 EUtilities API (esearch, esummary, efetch)
- 需要配置 API_KEY 和 EMAIL 环境变量
- 实现了速率限制和错误重试机制

### 缓存管理
- 内存缓存使用 Map 对象，LRU淘汰策略
- 文件缓存存储在 `cache/papers/` 目录
- 支持缓存统计和清理操作

### LLM 优化特性
- 结构化输出格式（compact, standard, detailed）
- 摘要智能截断和关键点提取
- 上下文窗口优化（通过 ABSTRACT_MODE 控制）

### 错误处理
- 实现了完整的错误捕获和日志记录
- 对网络超时、API限制等异常情况的处理
- 缓存失效时的降级策略

## 测试和部署

### 本地测试
```bash
# 直接运行服务器进行测试
node src/index.js

# 测试特定工具
# 需要通过MCP客户端（如Claude Desktop, Cline等）进行测试
```

### 部署配置
项目支持多种MCP客户端：
- **Claude Desktop**: 使用 `claude_desktop_config.json`
- **Cline (VS Code)**: 配置在VS Code设置中
- **Cherry Studio**: 使用完整路径配置
- **Claude Code (CLI)**: 配置在 `~/.claude/config.json`

### 环境变量
- `PUBMED_API_KEY`: NCBI API密钥（必需）
- `PUBMED_EMAIL`: 用于API请求的邮箱（必需）
- `ABSTRACT_MODE`: 摘要模式（可选，默认quick）

## 项目结构原则

- **单一职责**: 专注于数据提供，不包含LLM分析逻辑
- **性能优先**: 通过缓存和批量操作优化响应速度
- **标准化**: 遵循MCP协议规范和PubMed API最佳实践
- **可配置性**: 通过环境变量和配置文件支持不同使用场景