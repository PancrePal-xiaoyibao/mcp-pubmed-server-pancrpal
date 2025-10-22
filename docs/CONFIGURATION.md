# 配置说明文档

## 🎯 功能默认状态

### ✅ 默认开启的功能
- **EndNote导出**: `ENDNOTE_EXPORT=enabled` (默认)
- **基础搜索**: 所有基础搜索功能默认开启
- **缓存系统**: 自动缓存机制默认开启

### ⚙️ 可选配置的功能
- **全文模式**: `FULLTEXT_MODE=disabled` (默认关闭)
- **摘要模式**: `ABSTRACT_MODE=quick` (默认快速模式)

## 🔧 环境变量配置

### 必需配置
```bash
# NCBI API密钥 - 必需
PUBMED_API_KEY=your_ncbi_api_key_here

# 邮箱地址 - 必需
PUBMED_EMAIL=your_email@example.com
```

### 可选配置
```bash
# 摘要模式
ABSTRACT_MODE=quick  # 或 deep

# 全文模式
FULLTEXT_MODE=disabled  # disabled, enabled, auto

# EndNote导出
ENDNOTE_EXPORT=enabled  # enabled, disabled
```

## 📁 MCP客户端配置

### 1. Cline (VS Code Extension)
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "node",
      "args": ["./src/index.js"],
      "cwd": ".",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled",
        "ENDNOTE_EXPORT": "enabled"
      }
    }
  }
}
```

### 2. Claude Desktop
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "command": "node",
      "args": ["/path/to/mcp-pubmed-server/src/index.js"],
      "cwd": "/path/to/mcp-pubmed-server",
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled",
        "ENDNOTE_EXPORT": "enabled"
      }
    }
  }
}
```

### 3. Cherry Studio (Windows)
```json
{
  "mcpServers": {
    "pubmed-data-server": {
      "name": "pubmed-data-server",
      "type": "stdio",
      "isActive": true,
      "command": "node",
      "args": ["Y:/software/mcp-pubmed-server/src/index.js"],
      "env": {
        "PUBMED_API_KEY": "你的API密钥",
        "PUBMED_EMAIL": "你的邮箱地址",
        "ABSTRACT_MODE": "deep",
        "FULLTEXT_MODE": "enabled",
        "ENDNOTE_EXPORT": "enabled"
      }
    }
  }
}
```

## 🚀 快速开始配置

### 最小配置（推荐）
```bash
# 只需要这两个必需配置
PUBMED_API_KEY=your_ncbi_api_key_here
PUBMED_EMAIL=your_email@example.com
```

### 完整配置（高级用户）
```bash
# 必需配置
PUBMED_API_KEY=your_ncbi_api_key_here
PUBMED_EMAIL=your_email@example.com

# 可选配置
ABSTRACT_MODE=deep
FULLTEXT_MODE=enabled
ENDNOTE_EXPORT=enabled
```

## 📊 功能配置说明

### EndNote导出功能
- **默认状态**: ✅ 开启
- **环境变量**: `ENDNOTE_EXPORT=enabled`
- **功能**: 自动导出RIS和BibTeX格式
- **文件位置**: `cache/endnote/`

### 全文模式功能
- **默认状态**: ❌ 关闭
- **环境变量**: `FULLTEXT_MODE=disabled`
- **功能**: 检测和下载开放获取论文
- **文件位置**: `cache/fulltext/`

### 摘要模式功能
- **默认状态**: ✅ 快速模式
- **环境变量**: `ABSTRACT_MODE=quick`
- **功能**: 控制摘要长度和详细程度

## 🔧 配置验证

### 检查配置是否生效
```bash
# 使用 pubmed_endnote_status 工具检查EndNote导出状态
{
  "name": "pubmed_endnote_status",
  "arguments": {
    "action": "stats"
  }
}
```

### 检查系统环境
```bash
# 使用 pubmed_system_check 工具检查系统状态
{
  "name": "pubmed_system_check",
  "arguments": {}
}
```

## 📝 配置示例

### 开发环境配置
```bash
PUBMED_API_KEY=your_dev_api_key
PUBMED_EMAIL=dev@example.com
ABSTRACT_MODE=quick
FULLTEXT_MODE=disabled
ENDNOTE_EXPORT=enabled
```

### 生产环境配置
```bash
PUBMED_API_KEY=your_prod_api_key
PUBMED_EMAIL=prod@example.com
ABSTRACT_MODE=deep
FULLTEXT_MODE=enabled
ENDNOTE_EXPORT=enabled
```

### 轻量级配置
```bash
PUBMED_API_KEY=your_api_key
PUBMED_EMAIL=your_email@example.com
# 其他配置使用默认值
```

## ⚠️ 注意事项

### 1. API密钥安全
- 不要在代码中硬编码API密钥
- 使用环境变量存储敏感信息
- 定期轮换API密钥

### 2. 存储空间
- EndNote导出文件较小，影响不大
- 全文模式会下载PDF文件，注意磁盘空间
- 定期清理缓存文件

### 3. 网络使用
- 遵守PubMed API使用限制
- 避免过度请求
- 合理使用带宽

## 🎯 推荐配置

### 新手用户
```bash
PUBMED_API_KEY=your_api_key
PUBMED_EMAIL=your_email@example.com
# 使用默认配置，EndNote导出自动开启
```

### 研究人员
```bash
PUBMED_API_KEY=your_api_key
PUBMED_EMAIL=your_email@example.com
ABSTRACT_MODE=deep
FULLTEXT_MODE=enabled
ENDNOTE_EXPORT=enabled
```

### 开发者
```bash
PUBMED_API_KEY=your_api_key
PUBMED_EMAIL=your_email@example.com
ABSTRACT_MODE=quick
FULLTEXT_MODE=disabled
ENDNOTE_EXPORT=enabled
```

---

**🎉 配置完成！EndNote导出功能默认开启，无需额外配置！**

只需要设置API密钥和邮箱，EndNote导出功能就会自动工作。
