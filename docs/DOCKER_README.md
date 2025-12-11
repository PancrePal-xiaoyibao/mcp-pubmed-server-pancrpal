# Docker 部署指南

本项目现已支持通过 Docker 部署，使用 SSE 协议提供服务。本文档提供完整的部署指南和配置说明。

## 前置要求

- Docker 20.10+
- Docker Compose（最新版本）
- Node.js 22.x (LTS)（用于本地开发或构建）

## 快速开始

### 1. 准备环境变量

创建一个 `.env` 文件（不要提交到版本控制）：

```bash
# 复制示例文件
cp .env.example .env

# 编辑 .env 文件，填入以下配置
# 必需配置
PUBMED_API_KEY=your_pubmed_api_key_here
PUBMED_EMAIL=your_email@example.com

# 可选配置
ABSTRACT_MODE=quick
FULLTEXT_MODE=disabled
ENDNOTE_EXPORT=enabled
PORT=3000
```

获取 PubMed API 密钥：
1. 访问 [NCBI API Key Management](https://www.ncbi.nlm.nih.gov/account/settings/)
2. 登录 NCBI 账户，生成 API 密钥

### 2. 使用 Docker Compose 部署（推荐）

```bash
# 构建并启动服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 3. 使用 Docker 命令直接部署

```bash
# 构建镜像
docker build -t mcp-pubmed-server .

# 创建本地缓存目录
mkdir -p cache

# 运行容器
docker run -d \
  --name mcp-pubmed-server \
  -p 3000:3000 \
  -v $(pwd)/cache:/app/cache \
  -e PUBMED_API_KEY=your_pubmed_api_key_here \
  -e PUBMED_EMAIL=your_email@example.com \
  -e ABSTRACT_MODE=quick \
  -e FULLTEXT_MODE=disabled \
  -e ENDNOTE_EXPORT=enabled \
  -e PORT=3000 \
  -e MCP_TRANSPORT=sse \
  mcp-pubmed-server

# 查看日志
docker logs -f mcp-pubmed-server

# 停止容器
docker stop mcp-pubmed-server
```

## 服务端点

部署后，服务将提供以下端点：

- **SSE 连接**: `http://localhost:3000/sse`
- **消息处理**: `http://localhost:3000/message`
- **健康检查**: `http://localhost:3000/health`

### 健康检查

```bash
curl http://localhost:3000/health
```

预期响应：
```json
{"status":"ok","mode":"sse","sessions":0}
```

## 环境变量配置

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `PUBMED_API_KEY` | 是 | - | NCBI API 密钥 |
| `PUBMED_EMAIL` | 是 | - | 用于 API 请求的邮箱 |
| `ABSTRACT_MODE` | 否 | quick | 摘要模式：quick(1500字符) 或 deep(6000字符) |
| `FULLTEXT_MODE` | 否 | disabled | 全文模式：disabled, enabled 或 auto |
| `ENDNOTE_EXPORT` | 否 | enabled | EndNote 导出：enabled 或 disabled |
| `PORT` | 否 | 3000 | 服务端口 |
| `MCP_TRANSPORT` | 否 | sse | 传输模式（固定为 sse） |

## 自定义端口

可以通过环境变量 `PORT` 自定义服务端口：

```bash
# 使用自定义端口
PORT=8080 docker-compose up -d

# 或在 docker-compose.yml 中修改
ports:
  - "8080:3000"
```

## 数据持久化

使用 Docker Compose 时，缓存数据会持久化到本地的 `./cache` 目录。如果该目录不存在，Docker Compose 会自动创建。

如果使用直接 Docker 命令，可以通过挂载卷来持久化数据：

```bash
# 创建本地缓存目录
mkdir -p cache

# 运行容器并挂载本地目录
docker run -d \
  --name mcp-pubmed-server \
  -p 3000:3000 \
  -v $(pwd)/cache:/app/cache \
  -e PUBMED_API_KEY=your_pubmed_api_key_here \
  -e PUBMED_EMAIL=your_email@example.com \
  mcp-pubmed-server
```

## 生产环境建议

对于生产环境，建议：
1. 使用反向代理（Nginx/Caddy）
2. 配置 HTTPS
3. 设置资源限制
4. 配置日志轮转和监控

### Nginx 反向代理示例

```nginx
server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 故障排除

### 常见问题

1. **容器启动失败**
   - 检查环境变量是否正确设置
   - 确认端口未被占用：`netstat -tulpn | grep 3000`

2. **API 调用失败**
   - 验证 PubMed API 密钥是否有效
   - 检查网络连接是否正常

3. **健康检查失败**
   - 确认服务是否正常启动：`docker logs mcp-pubmed-server`
   - 检查防火墙设置

### 调试命令

```bash
# 查看容器状态
docker ps -a

# 查看容器日志
docker logs mcp-pubmed-server

# 进入容器调试
docker exec -it mcp-pubmed-server sh

# 检查容器资源使用
docker stats mcp-pubmed-server
```

## 更新部署

```bash
# 使用 Docker Compose
docker-compose pull
docker-compose up -d

# 使用 Docker 命令
docker pull mcp-pubmed-server:latest
docker stop mcp-pubmed-server
docker rm mcp-pubmed-server
# 然后重新运行容器命令
```

## Docker 文件说明

本项目包含以下 Docker 相关文件：

1. **Dockerfile** - Docker 镜像构建文件
   - 基于 Node.js 22 Alpine（最新 LTS 版本）
   - 安装必要的系统依赖（curl、wget、bash）
   - 配置环境变量和端口
   - 设置健康检查

2. **.dockerignore** - Docker 构建忽略文件
   - 排除不必要的文件和目录
   - 减小镜像大小和构建时间

3. **docker-compose.yml** - Docker Compose 配置文件
   - 简化部署流程（无需指定版本号）
   - 支持环境变量配置
   - 使用本地目录挂载实现数据持久化（./cache）
   - 设置健康检查