# Unstream frontend — Vite build served by nginx, which also proxies /api
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Slow or filtered networks: --build-arg NPM_CONFIG_REGISTRY=<mirror>
ARG NPM_CONFIG_REGISTRY
ARG NPM_CONFIG_FETCH_TIMEOUT=300000
ARG NPM_CONFIG_FETCH_RETRIES=5
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html
# Runs before nginx and writes /config.js from the environment — the one
# setting (UNSTREAM_DEFAULT_LOCALE) that must not need a rebuild.
COPY docker-entrypoint.d/ /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/*.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1
