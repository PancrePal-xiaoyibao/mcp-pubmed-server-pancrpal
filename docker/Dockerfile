FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=8745

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

EXPOSE 8745

CMD ["node", "src/index.js", "--mode=streamableHttp"]
