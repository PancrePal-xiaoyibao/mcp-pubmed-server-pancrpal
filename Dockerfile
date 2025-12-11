# 使用 Node.js 22 Alpine 作为基础镜像
FROM node:22-alpine

# 设置工作目录
WORKDIR /app

# 安装必要的系统依赖
RUN apk add --no-cache \
    curl \
    wget \
    bash \
    && rm -rf /var/cache/apk/*

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装项目依赖
RUN npm ci --only=production

# 复制项目源代码
COPY src/ ./src/
COPY .env.example ./.env

# 创建缓存目录
RUN mkdir -p ./cache/papers ./cache/fulltext ./cache/endnote

# 设置环境变量
ENV NODE_ENV=production
ENV PORT=3000
ENV MCP_TRANSPORT=sse

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# 启动命令
CMD ["node", "src/index.js", "--mode=sse"]