FROM node:22-bookworm-slim

WORKDIR /app

# better-sqlite3 compiles a native addon at install time when no prebuilt
# binary matches this platform/arch — these make that always work rather
# than depending on prebuild-install's luck.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/dbml-engine/package.json packages/dbml-engine/package.json

# `--ignore-scripts` is what makes this manifests-first layer work at all: the
# root package.json's `postinstall` builds packages/shared and
# packages/dbml-engine with tsc, but their sources and tsconfigs aren't in the
# image yet at this point, so running it here failed the image build outright.
# The explicit `npm run build` below already covers both packages. The one
# install script that *is* required is better-sqlite3's native compile, so ask
# for it back by name.
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
ENV ATHANORDB_DB_PATH=/data/athanordb.sqlite

# Don't run as root. `/data` is created and chowned here so the named volume
# mounted over it inherits this ownership when Docker first populates it.
RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
