# Unified Competition Platform
# Stage 1 builds the web app; stage 2 is a small runtime with only the server
# (the server has no npm dependencies: Node.js built-ins only).
# Works as-is with docker compose (own server) and with Koyeb's Dockerfile builder.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./web
COPY shared ./shared
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=384 \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TRUST_PROXY=true
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --from=build --chown=node:node /app/web/dist ./web/dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
