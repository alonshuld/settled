# API image (Render free web service). Build context = repo root.
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @settled/api...
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @settled/core build && pnpm --filter @settled/api build

FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/api
EXPOSE 3001
# Render free has no pre-deploy hook, so migrations run before the server starts.
# `migrate deploy` is idempotent and takes an advisory lock, so a restart is safe.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && exec node dist/main.js"]
