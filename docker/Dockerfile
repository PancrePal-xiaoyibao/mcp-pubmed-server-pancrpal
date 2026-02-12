FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8745

WORKDIR /app

# Install upstream server deps
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
RUN npm ci --omit=dev && npm cache clean --force

# Install gateway deps (separate package.json to avoid SDK version conflicts)
COPY docker/gateway/package.json ./docker/gateway/package.json
RUN cd docker/gateway \
  && npm install --omit=dev \
  && npm cache clean --force

# Copy source code (server + gateway)
COPY src ./src
COPY docker/gateway/index.js ./docker/gateway/index.js

EXPOSE 8745

CMD ["node", "docker/gateway/index.js"]
