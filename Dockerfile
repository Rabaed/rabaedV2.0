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

# veraPDF 1.30.3, the PDF/A-3 validator of the Documental Records' checks (RP-155, ADR 0023): its
# jars come from the official image (pinned by digest), and run on the worker's own Java below.
FROM verapdf/cli@sha256:d565095c67a083e693aebf7d1a15784007370571053fc1aa5b502665b9a78f9c AS verapdf

FROM node-service AS worker
WORKDIR /app/apps/worker
# Headless Chromium for the Documental Records (RP-620, ADR 0023): Playwright's own build of the
# version playwright-core expects, with its system libraries, where the node user can run it.
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN ./node_modules/.bin/playwright-core install --with-deps --only-shell chromium \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*
# A Java runtime and veraPDF's program, for the checks before a record is published (RP-155).
RUN apt-get update && apt-get install -y --no-install-recommends default-jre-headless \
    && rm -rf /var/lib/apt/lists/*
COPY --from=verapdf /opt/verapdf /opt/verapdf
ENV VERAPDF=cli VERAPDF_PATH=/opt/verapdf/verapdf
USER node
CMD ["./node_modules/.bin/tsx", "src/main.ts"]

# The licensed Thmanyah fonts, never in the repo or the build context: the
# deploy workflow passes them with `--build-context fonts=<folder>` (holding
# thmanyah/*.woff2). Without them this stage is empty and Arabic falls back to
# IBM Plex Sans Arabic (packages/ui/src/fonts/arabic-font.ts).
FROM scratch AS fonts

# Rabaed Admin (ADR 0010): its own image and service, never the customer api's. Its
# Workflows page (RP-443) is the builder from @rabaed/ui, built into apps/admin/dist and
# served from /assets; Arabic uses the licensed fonts only when the deploy supplies them.
FROM deps AS admin-build
COPY --from=fonts / packages/ui/fonts/
RUN pnpm --filter @rabaed/admin build

FROM node-service AS admin
COPY --from=admin-build --chown=node:node /app/apps/admin/dist /app/apps/admin/dist
WORKDIR /app/apps/admin
EXPOSE 4050
CMD ["./node_modules/.bin/tsx", "src/server.ts"]

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
