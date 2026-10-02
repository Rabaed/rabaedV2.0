# syntax=docker/dockerfile:1.7
#
# One image per service: `docker build --target web|api|admin|worker .`
# Migrations run from the api image (packages/infra/src/migrations-stack.ts).
# The deploy workflow builds these on every merge to main; configuration and
# secrets come from the task definition at runtime, never from the image.

FROM node:24-slim AS base
ENV COREPACK_HOME=/opt/corepack \
    PNPM_STORE_DIR=/pnpm/store
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
WORKDIR /app

# Dependencies, fetched from the lockfile alone so this layer is reused until it changes.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --store-dir=/pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --offline --frozen-lockfile --store-dir=/pnpm/store

# api and worker run their TypeScript through tsx, as in development.
# RDS requires TLS; the CA bundle lets them verify the database's certificate.
FROM deps AS node-service
# Downloaded, then installed: ADD --chmod would also give the folders it creates
# (/etc/ssl) mode 644, which the node user cannot enter.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /tmp/rds-global-bundle.pem
RUN install -D -m 644 /tmp/rds-global-bundle.pem /etc/ssl/rds/global-bundle.pem && rm /tmp/rds-global-bundle.pem
ENV NODE_ENV=production
USER node

FROM node-service AS api
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["./node_modules/.bin/tsx", "src/server.ts"]

# Rabaed Admin (ADR 0010): its own image and service, never the customer api's.
FROM node-service AS admin
WORKDIR /app/apps/admin
EXPOSE 4050
CMD ["./node_modules/.bin/tsx", "src/server.ts"]

FROM node-service AS worker
WORKDIR /app/apps/worker
CMD ["./node_modules/.bin/tsx", "src/main.ts"]

# The licensed Thmanyah fonts, never in the repo or the build context: the
# deploy workflow passes them with `--build-context fonts=<folder>` (holding
# thmanyah/*.woff2). Without them this stage is empty and Arabic falls back to
# IBM Plex Sans Arabic (packages/ui/src/fonts/arabic-font.ts).
FROM scratch AS fonts

FROM deps AS web-build
COPY --from=fonts / packages/ui/fonts/
RUN pnpm --filter @rabaed/web build

FROM web-build AS web
ENV NODE_ENV=production
# Next.js writes its cache under .next at runtime.
RUN chown -R node:node /app/apps/web/.next
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
