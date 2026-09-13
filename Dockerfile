FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install -g pnpm@12.4.1
WORKDIR /app
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile
RUN mkdir -p /data/artifacts && chown -R node:node /app /data/artifacts
FROM base AS build
RUN pnpm build
FROM base AS web
COPY --chown=node:node --from=build /app/apps/web/.next /app/apps/web/.next
USER node
EXPOSE 3000
CMD ["pnpm","--filter","@scrapepilot/web","start"]
FROM base AS worker
RUN pnpm --filter @scrapepilot/scraper-engine exec playwright install --with-deps chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright
RUN cp -r /root/.cache/ms-playwright /opt/browsers && chmod -R a+rX /opt/browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
USER node
EXPOSE 3001
CMD ["pnpm","--filter","@scrapepilot/worker","start"]
