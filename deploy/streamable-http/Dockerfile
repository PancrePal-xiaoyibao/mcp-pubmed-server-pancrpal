FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8745

WORKDIR /app

# Install upstream server deps
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm ci --omit=dev && npm cache clean --force

# Install gateway deps (separate package.json to avoid SDK version conflicts)
COPY deploy/streamable-http/gateway/package.json ./deploy/streamable-http/gateway/package.json
RUN cd deploy/streamable-http/gateway \
  && npm install --omit=dev \
  && npm cache clean --force

# Copy source code (server + gateway)
COPY src ./src
COPY config ./config
COPY docs ./docs
COPY deploy/streamable-http/gateway/index.js ./deploy/streamable-http/gateway/index.js

EXPOSE 8745

CMD ["node", "deploy/streamable-http/gateway/index.js"]

