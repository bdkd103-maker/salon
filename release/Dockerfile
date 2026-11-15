# Build only from the generated allowlisted context, never from the repository.
# Linux build recipe; not executed or deployed by the packaging script.
FROM node:24-bookworm AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY backend/typings ./typings
COPY backend/tsconfig.json ./
# generate does not connect to a database. Never run migrations in this image.
RUN npm run db:generate && npm run build

# Explicit optional tooling target. Building it never connects to a database.
# No apply mode exists: its entrypoint only verifies preparation/offline selection.
FROM build AS migration-tools
WORKDIR /app
COPY --chown=node:node scripts/bootstrap-empty-staging.mjs ./scripts/bootstrap-empty-staging.mjs
COPY --chown=node:node release/clean-install ./release/clean-install
USER node
ENTRYPOINT ["node", "/app/scripts/bootstrap-empty-staging.mjs"]

FROM build AS production-dependencies
RUN cp -a node_modules/.prisma /opt/generated-prisma \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=4000 STAFF_ONBOARDING_ENABLED=false
WORKDIR /app/backend
COPY --from=production-dependencies --chown=node:node /app/backend/package.json /app/backend/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /opt/generated-prisma ./node_modules/.prisma
COPY --from=production-dependencies --chown=node:node /app/backend/dist ./dist
COPY --from=production-dependencies --chown=node:node /app/backend/prisma ./prisma
COPY --chown=node:node www /app/www
USER node
# Metadata only: does not publish this port. No static server or public gateway.
EXPOSE 4000
CMD ["node", "dist/server.js"]
