# C.O.R.E. production image.
#
# One image serves the API and the built web app from a single origin, so the
# session cookie is first-party and there is no CORS surface in production.
#
# Multi-stage: the build stage carries the whole toolchain, the runtime stage
# carries only what is needed to run.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Manifests first: this layer is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

RUN npm ci --workspaces --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/ apps/

# The API depends on the engine's compiled output, so the engine builds first.
RUN npm run build --workspace @core/engine \
 && npm run build --workspace @core/web \
 && npm run build --workspace @core/api

# The web bundle is served by the API, so it moves next to it.
RUN mkdir -p apps/api/public && cp -r apps/web/dist/. apps/api/public/

# Reinstall without dev dependencies for the runtime layer.
RUN npm ci --workspaces --include-workspace-root --omit=dev

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0

WORKDIR /app

# Run unprivileged. The node image already provides a non-root `node` user.
COPY --from=build --chown=node:node /app/node_modules node_modules/
COPY --from=build --chown=node:node /app/package.json package.json
COPY --from=build --chown=node:node /app/packages/engine/dist packages/engine/dist/
COPY --from=build --chown=node:node /app/packages/engine/package.json packages/engine/package.json
COPY --from=build --chown=node:node /app/apps/api/dist apps/api/dist/
COPY --from=build --chown=node:node /app/apps/api/drizzle apps/api/drizzle/
COPY --from=build --chown=node:node /app/apps/api/public apps/api/public/
COPY --from=build --chown=node:node /app/apps/api/package.json apps/api/package.json

# There is deliberately no apps/api/node_modules here: npm workspaces hoists
# every dependency to the root node_modules, and the @core/engine entry there is
# a symlink into packages/engine, which is copied above.

USER node
EXPOSE 4000

# The platform's own health check should use /readiness, which verifies the
# database and that migrations have run. /health only says the process is alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/readiness').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run at startup inside the entry point, before the port is bound.
CMD ["node", "apps/api/dist/index.js"]
