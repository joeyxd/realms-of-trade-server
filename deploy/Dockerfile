FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392

ARG GIT_COMMIT=unknown
ARG APP_VERSION=unknown

LABEL org.opencontainers.image.title="Marea Negra" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.revision="$GIT_COMMIT"

ENV NODE_ENV=production \
    PORT=5173 \
    HOST=0.0.0.0

WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
RUN test -x /usr/bin/flock

COPY --chown=node:node index.html ./index.html
COPY --chown=node:node server/ ./server/
COPY --chown=node:node src/ ./src/
COPY --chown=node:node styles/ ./styles/
COPY --chown=node:node assets/ ./assets/
COPY --chown=node:node deploy/runtime.mjs ./deploy/runtime.mjs

USER node
EXPOSE 5173

CMD ["node", "deploy/runtime.mjs"]
