FROM node:24-alpine AS base
WORKDIR /app
RUN npm install -g pnpm@12.14.0

FROM base AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @flacso/contracts build
RUN pnpm --filter api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Entrypoint que baja de root a `node` (ver el script). `su-exec` es el equivalente liviano de gosu en Alpine.
RUN apk add --no-cache su-exec
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# El `sed` quita los fines de línea CRLF que deja un checkout en Windows y que romperían el shebang.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
