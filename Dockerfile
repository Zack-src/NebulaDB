# syntax=docker/dockerfile:1
# Base image pinned by digest (tag kept for readability: node:22-bookworm-slim).
# Bump both together; Dependabot/Renovate can follow the digest.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d

# ---------------------------------------------------------------------------
# Build stage: toolchain + dev dependencies, compiles everything.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build

WORKDIR /app

# better-sqlite3 (SQLite as a target engine, and `migrate-from-sqlite`)
# compiles a native addon at install time when no prebuilt binary matches
# this platform/arch — these make that always work rather than depending on
# prebuild-install's luck. They stay in this stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/dbml-engine/package.json packages/dbml-engine/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/mcp/package.json packages/mcp/package.json

# `--ignore-scripts` is what makes this manifests-first layer work at all: the
# root package.json's `postinstall` builds packages/shared and
# packages/dbml-engine with tsc, but their sources and tsconfigs aren't in the
# image yet at this point. The explicit `npm run build` below already covers
# both packages. The one install script that *is* required is better-sqlite3's
# native compile, so ask for it back by name.
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY . .
RUN npm run build

# Drop devDependencies in place: the native binaries of the production
# dependencies (better-sqlite3, sharp) built above are kept as-is.
RUN npm prune --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Runtime stage: production node_modules + built artifacts only. No compiler,
# no sources, no devDependencies.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PORT=3001
# NebulaDB's own data is in PostgreSQL (NEBULADB_DATABASE_URL, no default);
# /data keeps the files: backups of connected databases.
ENV NEBULADB_DATABASE_BACKUP_DIR=/data/database-backups
# libuv's default pool is 4 threads, shared by fs, scrypt (logins) and sharp
# (PNG rendering): a burst of one starves the others.
ENV UV_THREADPOOL_SIZE=12

WORKDIR /app

# --chown on COPY sets ownership at copy time: no recursive `chown -R /app`
# layer (which duplicated the whole tree and took minutes). The app only needs
# to read /app; node_modules/@nebuladb/* are workspace symlinks, preserved.
COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=build /app/packages/dbml-engine/package.json ./packages/dbml-engine/package.json
COPY --chown=node:node --from=build /app/packages/dbml-engine/dist ./packages/dbml-engine/dist
COPY --chown=node:node --from=build /app/packages/cli/package.json ./packages/cli/package.json
COPY --chown=node:node --from=build /app/packages/cli/dist ./packages/cli/dist
COPY --chown=node:node --from=build /app/packages/mcp/package.json ./packages/mcp/package.json
COPY --chown=node:node --from=build /app/packages/mcp/dist ./packages/mcp/dist
COPY --chown=node:node --from=build /app/apps/server/package.json ./apps/server/package.json
# Includes dist/modules/projects/parseWorker.js (DBML parsing worker).
COPY --chown=node:node --from=build /app/apps/server/dist ./apps/server/dist
# Served by the server from ../../web/dist relative to apps/server/dist.
COPY --chown=node:node --from=build /app/apps/web/dist ./apps/web/dist

# `/data` is created and chowned here (only it) so the named volume mounted
# over it inherits this ownership when Docker first populates it.
RUN mkdir -p /data && chown node:node /data
USER node

VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Node as PID 1 doesn't reap zombies or forward signals by default: run with
# `docker run --init` (docker-compose.yml sets `init: true`).
CMD ["node", "apps/server/dist/index.js"]
