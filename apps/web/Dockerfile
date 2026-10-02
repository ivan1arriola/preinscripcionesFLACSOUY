FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install -g pnpm@12.8.1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/ ./apps/web/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @flacso/contracts build
RUN pnpm --filter web build

FROM nginx:alpine AS runner
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
