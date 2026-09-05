# Base: Wolfi (Chainguard) rather than node:*-alpine. Hardened, glibc, and its npm 12 blocks
# dependency install-scripts by default — the vector supply-chain worms use. Every package
# allowed to run one is named explicitly below, so a compromised transitive dep cannot execute
# anything during the build.
# Pin the multi-platform index; refresh deliberately to pick up base-image updates.
ARG WOLFI=cgr.dev/chainguard/wolfi-base@sha256:918a593b8268c222afd4e2c4f06860ac984e60719b4697e4c71d796bc8fcd042

# ── Stage 1: Build ──
FROM ${WOLFI} AS builder
RUN apk add --no-cache nodejs-22 npm
WORKDIR /app

# Install dependencies (leverage Docker cache)
COPY package.json package-lock.json ./
COPY packages/backend/package.json packages/backend/
COPY packages/frontend/package.json packages/frontend/
COPY packages/shared/package.json packages/shared/
# npm 12 refuses install-scripts unless approved. Approve the ones we actually need — native
# addons fetching their prebuild, and Prisma fetching its engines — then rebuild so they run.
# Pinned entries (`pkg@version`) mean a new version has to be re-approved deliberately.
RUN npm ci --no-audit --no-fund \
 && npm install-scripts approve --allow-scripts-pin \
      esbuild prisma @prisma/client @prisma/engines better-sqlite3 bcrypt \
 && npm rebuild

# Copy source
COPY packages/shared packages/shared
COPY packages/backend packages/backend
COPY packages/frontend packages/frontend

# Generate Prisma client
RUN npx prisma generate --schema=packages/backend/prisma/schema.prisma

# Build shared first — backend + frontend both import @oscarr/shared compiled to JS.
RUN npm run build --workspace=packages/shared

# Bundle backend into a single dist/server.js (~2.8 MB). Natives (bcrypt, bare-*, better-sqlite3)
# + Prisma stay external — they need real files on disk. See esbuild.config.mjs for the list.
RUN npm run build:bundle --workspace=packages/backend

# Build frontend
RUN npm run build --workspace=packages/frontend

# ── Stage 2: Production ──
FROM ${WOLFI}

# nodejs-22 pinned to the same major the bundle targets — better-sqlite3 and bcrypt ship
# prebuilds per Node ABI, so a runtime major bump silently breaks them.
# tini = PID 1 init (signal forwarding + zombie reaping).
# su-exec = drop from root → oscarr in the entrypoint after chowning /data.
# wget = HEALTHCHECK binary.
RUN apk add --no-cache nodejs-22 npm tini su-exec wget

# Create the non-root user BEFORE any COPY so --chown=oscarr:oscarr on the COPY lines
# bakes ownership into each layer without a 300+ MB post-copy `chown -R`.
# UID 1001 is deliberate: it matches the previous image, so existing /data volumes keep working.
RUN addgroup -S -g 1001 oscarr \
 && adduser -S -G oscarr -u 1001 oscarr \
 && mkdir -p /data \
 && chown oscarr:oscarr /data

WORKDIR /app

# Install ONLY the runtime externals (Prisma + native modules) from a trimmed manifest.
# Everything else (fastify, axios, archiver, swagger, zod, …) is inlined in dist/server.js.
# Then strip npm itself: ensureMigrated() calls node_modules/.bin/prisma directly, so npm is
# not needed at runtime — and its transitive deps regularly ship vulns the scanner picks up.
# `npm ci` against a committed lockfile, not `npm install`: the latter re-resolves every range
# on each build, so a version published minutes earlier — compromised or simply broken — can walk
# straight into the image. ci installs the exact tree that was reviewed, and refuses outright if
# the manifest and the lockfile drift apart.
# Regenerate with: npm run lock:prod --workspace=packages/backend
COPY --chown=oscarr:oscarr packages/backend/package.prod.json packages/backend/package.json
COPY --chown=oscarr:oscarr packages/backend/package.prod-lock.json packages/backend/package-lock.json
WORKDIR /app/packages/backend
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install-scripts approve --allow-scripts-pin prisma @prisma/client @prisma/engines better-sqlite3 bcrypt \
 && npm rebuild \
 # Prisma ships engines for every platform and query runtimes for every datasource; this app is
 # SQLite on Node, so the browser/edge/wasm builds and the other database runtimes are dead
 # weight. The download cache is a build artefact and is never read at runtime.
 && rm -rf /root/.cache/prisma /root/.npm \
 && find node_modules/@prisma/client/runtime -type f \
      \( -name '*edge*' -o -name '*browser*' -o -name '*react-native*' -o -name '*.wasm' \
         -o -name '*cockroachdb*' -o -name '*postgresql*' -o -name '*mysql*' -o -name '*sqlserver*' \) \
      -delete \
 && apk del npm
WORKDIR /app

# Bundled backend server + its sourcemap (keeps stack traces useful in prod logs).
COPY --from=builder --chown=oscarr:oscarr /app/packages/backend/dist/server.js packages/backend/dist/server.js
COPY --from=builder --chown=oscarr:oscarr /app/packages/backend/dist/server.js.map packages/backend/dist/server.js.map

# Frontend bundle served by @fastify/static from the bundled backend.
COPY --from=builder --chown=oscarr:oscarr /app/packages/frontend/dist packages/frontend/dist

# Prisma schema + migrations: the bundled server still shells out to `prisma migrate deploy`
# on boot, so the schema and migrations folder need to be on disk.
COPY --chown=oscarr:oscarr packages/backend/prisma packages/backend/prisma

# Prisma generated client + platform-specific engines, copied from the builder (they were
# generated there during `prisma generate`).
COPY --from=builder --chown=oscarr:oscarr /app/node_modules/.prisma packages/backend/node_modules/.prisma

# Root package.json used by src/routes/app.ts + services/backupService.ts for the app version.
COPY --chown=oscarr:oscarr package.json .

# Entrypoint: chown /data (covers upgrade from pre-1001 volumes + host bind mounts) then
# su-exec oscarr. Kept as root so it can chown; drops privileges before exec-ing CMD.
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/oscarr.db
# install.json lives next to the SQLite DB in the persisted volume — the default `./data/…` is
# relative to the container's cwd (/app) and ends up in the ephemeral writable layer, which
# means the flag is lost on every container recreate (image upgrade, admin restart, …) and the
# install wizard shows up again on an already-installed instance.
ENV INSTALL_FILE_PATH=/data/install.json
ENV PORT=3456

EXPOSE 3456

# /install-status is always mounted (setup.ts). 30s grace at startup covers prisma migrate deploy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider http://localhost:3456/api/setup/install-status || exit 1

# tini → entrypoint.sh → node as oscarr. Exec-form throughout so docker stop propagates SIGTERM.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "packages/backend/dist/server.js"]
