# Multi-stage build for Next.js standalone output.
# Builds on the server (no image registry). See docker-compose.yml / deploy.sh.

ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# Retries help on flaky server→registry links (ETIMEDOUT during npm ci).
RUN --mount=type=cache,target=/root/.npm \
  npm ci --no-audit --no-fund \
    --fetch-retries=5 \
    --fetch-retry-mintimeout=20000 \
    --fetch-retry-maxtimeout=120000

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Bake build stamp into the client bundle (YYYY-MM-DD-HH-MM-SS, Europe/Berlin)
ARG BUILD_TIME=
RUN BT="${BUILD_TIME}" \
  && if [ -z "$BT" ]; then BT="$(TZ=Europe/Berlin date +%Y-%m-%d-%H-%M-%S)"; fi \
  && echo "Build version: $BT" \
  && NEXT_PUBLIC_BUILD_TIME="$BT" npm run build

FROM node:${NODE_VERSION} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir .next && chown node:node .next
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# Example Smarthome YAML (live file is bind-mounted via compose).
COPY --from=builder --chown=node:node /app/config ./config

USER node
EXPOSE 3000
CMD ["node", "server.js"]
