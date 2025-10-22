# 全文模式与智能下载系统完整指南

## 🎯 系统概述

全文模式与智能下载系统是MCP PubMed服务器的高级功能组合，提供完整的开放获取论文检测、跨平台下载和本地文献库管理能力。

## 🚀 快速开始

### 1. 环境配置

在 `.env` 文件中添加以下配置：

```bash
# 启用全文模式
FULLTEXT_MODE=enabled  # disabled, enabled, auto

# 其他必需配置
PUBMED_API_KEY=your_ncbi_api_key_here
PUBMED_EMAIL=your_email@example.com
ABSTRACT_MODE=deep
```

### 2. 模式说明

- **`disabled`** (默认): 禁用全文功能
- **`enabled`**: 启用全文检测，手动下载
- **`auto`**: 启用全文检测，自动下载可用的OA论文

## 🛠️ 完整工具集

### 基础工具

#### 1. `pubmed_search` - 智能文献搜索
```json
{
  "query": "acupuncture gut microbiome",
  "max_results": 20,
  "days_back": 30,
  "sort_by": "relevance"
}
```

#### 2. `pubmed_get_details` - 详细信息获取
```json
{
  "pmids": ["38412345", "38412346"],
  "include_full_text": true
}
```

#### 3. `pubmed_extract_key_info` - 关键信息提取
```json
{
  "pmid": "38412345",
  "extract_sections": ["basic_info", "abstract_summary", "authors", "keywords"],
  "max_abstract_length": 2000
}
```

#### 4. `pubmed_cross_reference` - 交叉引用分析
```json
{
  "pmid": "38412345",
  "reference_type": "similar",
  "max_results": 10
}
```

#### 5. `pubmed_batch_query` - 批量查询优化
```json
{
  "pmids": ["38412345", "38412346", "38412347"],
  "query_format": "llm_optimized",
  "include_abstracts": true
}
```

### 全文模式工具

#### 6. `pubmed_detect_fulltext` - 检测全文可用性
```json
{
  "pmid": "38412345",
  "auto_download": false
}
```

**功能**:
- 检测文献的开放获取状态
- 支持PMC、Unpaywall、出版商多源检测
- 可选择自动下载可用全文

#### 7. `pubmed_download_fulltext` - 下载全文PDF
```json
{
  "pmid": "38412345",
  "force_download": false
}
```

**功能**:
- 下载指定文献的全文PDF
- 支持强制重新下载
- 自动检查缓存状态

#### 8. `pubmed_fulltext_status` - 全文缓存管理
```json
{
  "action": "stats",  // stats, list, clean, clear
  "pmid": "38412345"  // 可选，仅用于list操作
}
```

**功能**:
- `stats`: 获取缓存统计信息
- `list`: 列出缓存的PDF文件
- `clean`: 清理过期文件
- `clear`: 清空所有缓存

### 智能下载工具

#### 9. `pubmed_batch_download` - 批量智能下载
```json
{
  "pmids": ["26000488", "26000487", "26000486"],
  "human_like": true
}
```

**功能特点**:
- 批量处理最多10个PMID
- 自动检测开放获取状态
- 类人操作模式（随机延迟）
- 详细的下载报告

#### 10. `pubmed_system_check` - 系统环境检测
```json
{}
```

**功能特点**:
- 检测操作系统和架构
- 验证下载工具可用性
- 提供系统优化建议
- 显示推荐配置

## 🔧 智能下载系统

### 核心特性

#### 1. 跨平台支持
- **Windows**: 使用PowerShell的`Invoke-WebRequest`
- **Linux/macOS**: 优先使用`wget`，备用`curl`
- **自动检测**: 运行时检测系统环境并选择最佳工具

#### 2. 类人操作模式
- **随机延迟**: 1-3秒随机间隔，模拟人类操作
- **下载间隔**: 2-5秒间隔，避免过于频繁的请求
- **用户代理**: 使用真实浏览器User-Agent
- **超时控制**: 60秒连接超时，300秒总超时

#### 3. 智能错误处理
- **重试机制**: 自动重试失败的下载
- **文件验证**: 检查下载文件大小和完整性
- **错误报告**: 详细的错误信息和解决建议

### 技术实现

#### 系统检测逻辑
```javascript
// 检测系统环境
detectSystemEnvironment() {
    const platform = os.platform();
    return {
        platform: platform,
        isWindows: platform === 'win32',
        isMacOS: platform === 'darwin',
        isLinux: platform === 'linux',
        downloadCommand: this.getDownloadCommand(platform)
    };
}
```

#### Windows PowerShell下载
```javascript
// PowerShell下载命令
const command = `powershell -Command "& {Invoke-WebRequest -Uri '${downloadUrl}' -OutFile '${filePath}' -UserAgent '${userAgent}' -TimeoutSec 60}"`;
```

#### Linux/macOS wget下载
```javascript
// wget下载命令
const command = `wget --user-agent='${userAgent}' --timeout=60 --tries=3 --continue -O '${filePath}' '${downloadUrl}'`;
```

#### 类人操作模式
```javascript
// 随机延迟模拟人类操作
const delay = Math.random() * 2000 + 1000; // 1-3秒
await new Promise(resolve => setTimeout(resolve, delay));

// 下载间隔
const interval = Math.random() * 3000 + 2000; // 2-5秒
await new Promise(resolve => setTimeout(resolve, interval));
```

## 📁 缓存系统

### 目录结构
```
cache/
├── papers/           # 论文元数据缓存
├── fulltext/         # 全文PDF缓存
│   ├── index.json   # 全文索引文件
│   ├── 38412345.pdf # PDF文件
│   └── 38412346.pdf
└── index.json       # 主索引文件
```

### 缓存配置
- **PDF缓存**: 90天过期
- **最大文件**: 50MB
- **索引管理**: 自动更新统计信息

### 索引管理
```javascript
// 全文索引结构
{
  "version": "1.0",
  "created": "2024-01-15T10:30:00.000Z",
  "fulltext_papers": {
    "26000488": {
      "pmid": "26000488",
      "downloadUrl": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4481139/pdf/",
      "sources": ["PMC"],
      "filePath": "26000488.pdf",
      "fileSize": 2048576,
      "downloaded": "2024-01-15T10:30:00.000Z",
      "downloadMethod": "PowerShell"
    }
  },
  "stats": {
    "totalPDFs": 1,
    "totalSize": 2048576,
    "lastCleanup": "2024-01-15T10:30:00.000Z"
  }
}
```

## 🔍 检测策略

### 多源检测
1. **PMC检测**: 检查PubMed Central免费全文
2. **Unpaywall检测**: 使用Unpaywall数据库
3. **出版商检测**: 直接检查出版商网站

### 检测流程
```
文献PMID → 获取基本信息 → 多源检测 → 下载PDF → 建立索引
```

## 📊 使用示例

### 示例1: 检查系统环境
```bash
# 使用 pubmed_system_check 工具
{
  "name": "pubmed_system_check",
  "arguments": {}
}
```

**返回结果**:
```json
{
  "success": true,
  "system_environment": {
    "system": {
      "platform": "win32",
      "arch": "x64",
      "isWindows": true,
      "downloadCommand": "powershell"
    },
    "tools": [
      {
        "name": "PowerShell",
        "available": true
      }
    ],
    "recommended": "powershell"
  },
  "recommendations": [
    "✅ PowerShell available - Windows downloads will use Invoke-WebRequest",
    "✅ Full-text mode enabled"
  ]
}
```

### 示例2: 检测文献全文可用性
```bash
# 使用 pubmed_detect_fulltext 工具
{
  "pmid": "38412345",
  "auto_download": true
}
```

**返回结果**:
```json
{
  "success": true,
  "pmid": "38412345",
  "article_info": {
    "title": "论文标题",
    "authors": ["作者1", "作者2"],
    "journal": "期刊名称",
    "doi": "10.1000/example"
  },
  "open_access": {
    "is_available": true,
    "sources": ["PMC"],
    "download_url": "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12345/pdf/",
    "pmcid": "PMC12345"
  },
  "download_result": {
    "success": true,
    "filePath": "/path/to/cache/fulltext/38412345.pdf",
    "fileSize": 2048576
  }
}
```

### 示例3: 批量下载论文
```bash
# 使用 pubmed_batch_download 工具
{
  "name": "pubmed_batch_download",
  "arguments": {
    "pmids": ["26000488", "26000487"],
    "human_like": true
  }
}
```

**返回结果**:
```json
{
  "success": true,
  "batch_download": {
    "total_requested": 2,
    "available_for_download": 2,
    "successful_downloads": 2,
    "failed_downloads": 0
  },
  "results": [
    {
      "pmid": "26000488",
      "title": "Drop-seq_Macosko_2015",
      "result": {
        "success": true,
        "filePath": "/path/to/cache/fulltext/26000488.pdf",
        "fileSize": 2048576,
        "method": "PowerShell"
      }
    }
  ],
  "human_like_mode": true
}
```

### 示例4: 查看缓存状态
```bash
# 使用 pubmed_fulltext_status 工具
{
  "action": "stats"
}
```

**返回结果**:
```json
{
  "success": true,
  "action": "stats",
  "stats": {
    "fulltext_mode": "enabled",
    "enabled": true,
    "auto_download": false,
    "cache_directory": "/path/to/cache/fulltext",
    "total_pdfs": 15,
    "total_size": 52428800,
    "last_cleanup": "2024-01-15T10:30:00.000Z"
  }
}
```

## ⚡ 性能优化

### 缓存策略
- **智能缓存**: 避免重复下载
- **过期管理**: 自动清理过期文件
- **大小限制**: 防止存储空间过度使用

### 下载优化
- **并发控制**: 单线程下载避免API限制
- **超时设置**: 60秒下载超时
- **错误重试**: 自动处理网络错误
- **类人操作**: 随机延迟避免被限制

### 错误处理
- **网络超时**: 60秒连接超时
- **文件大小**: 50MB最大文件限制
- **重试机制**: 最多3次重试
- **错误报告**: 详细的错误信息

## 🔧 故障排除

### 常见问题

1. **"Full-text mode is not enabled"**
   - 检查 `FULLTEXT_MODE` 环境变量设置
   - 确保设置为 `enabled` 或 `auto`

2. **"No open access full-text available"**
   - 文献可能不是开放获取
   - 尝试手动检查PMC或出版商网站

3. **"PowerShell not available"**
   - 确保Windows系统支持PowerShell
   - 检查PowerShell执行策略

4. **"wget not found"**
   - 安装wget: `sudo apt-get install wget` (Ubuntu)
   - 或使用curl作为备用

5. **"Download failed"**
   - 检查网络连接
   - 验证下载URL有效性
   - 查看详细错误信息

6. **"PDF too large"**
   - 文件超过50MB限制
   - 可以调整 `MAX_PDF_SIZE` 环境变量

### 调试模式
```bash
# 启用详细日志
NODE_ENV=development node src/index.js

# 检查系统环境
# 使用 pubmed_system_check 工具
```

## 📈 使用场景

### 1. 学术研究
- 自动收集相关领域文献
- 建立个人文献库
- 支持离线阅读和分析
- 批量获取开放获取论文

### 2. 文献综述
- 批量获取开放获取论文
- 自动筛选相关文献
- 建立专题文献集合
- 交叉引用分析

### 3. 事实核查
- 获取原始文献进行验证
- 支持深度文献分析
- 提供完整的引用链
- 多源验证信息

## 📊 使用统计

### 下载统计
- **成功率**: 基于系统环境和网络条件
- **平均速度**: 取决于文件大小和网络速度
- **缓存命中**: 避免重复下载

### 性能指标
- **下载时间**: 1-5分钟/文件（取决于大小）
- **内存使用**: 最小化内存占用
- **磁盘空间**: 自动清理过期文件

## 🎯 最佳实践

### 1. 环境配置
```bash
# 推荐配置
FULLTEXT_MODE=enabled
ABSTRACT_MODE=deep
```

### 2. 批量下载策略
- 分批处理大量论文（每次10个）
- 使用类人操作模式避免被限制
- 定期清理缓存目录

### 3. 错误处理
- 监控下载成功率
- 处理网络异常
- 备份重要文件

## 🔒 注意事项

### 法律合规
- 仅下载开放获取论文
- 遵守出版商使用条款
- 尊重版权和知识产权

### 存储管理
- 定期清理过期文件
- 监控存储空间使用
- 备份重要文献

### 网络使用
- 遵守API使用限制
- 避免过度请求
- 合理使用带宽

## 🚀 未来改进

### 计划功能
- **断点续传**: 支持大文件断点续传
- **并行下载**: 多线程下载支持
- **智能重试**: 基于错误类型的智能重试
- **下载队列**: 任务队列管理

### 性能优化
- **压缩传输**: 支持gzip压缩
- **CDN加速**: 智能选择下载源
- **缓存预热**: 预下载热门论文

---

**🎉 全文模式与智能下载系统让您的研究更加高效！**

通过智能检测、跨平台下载和类人操作模式，您可以轻松建立个人文献库，支持深度学术研究和分析。
