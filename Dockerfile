FROM node:26-bookworm-slim AS runtime
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.4.1
WORKDIR /app
FROM runtime AS base
# Download packages from the lockfile before copying the source, so code-only changes reuse this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile --offline
RUN mkdir -p /data/artifacts && chown -R node:node /app /data/artifacts
FROM base AS build
RUN pnpm build
FROM base AS web
COPY --chown=node:node --from=build /app/apps/web/.next /app/apps/web/.next
USER node
EXPOSE 3000
CMD ["pnpm","--filter","@scrapepilot/web","start"]
# Chromium and its system libraries change only with the Playwright version pinned by the engine.
FROM runtime AS browsers
COPY packages/scraper-engine/package.json /tmp/engine.json
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
RUN npx --yes "playwright@$(node -p "require('/tmp/engine.json').dependencies.playwright")" install --with-deps chromium \
  && chmod -R a+rX /opt/browsers
FROM browsers AS worker
COPY --chown=node:node --from=base /app /app
RUN mkdir -p /data/artifacts && chown node:node /data/artifacts
USER node
EXPOSE 3001
CMD ["pnpm","--filter","@scrapepilot/worker","start"]
