ARG NODE_IMAGE=node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5
ARG RUST_IMAGE=rust:1.88-bookworm@sha256:af306cfa71d987911a781c37b59d7d67d934f49684058f96cf72079c3626bfe0
ARG SOURCE_DATE_EPOCH=0
FROM ${RUST_IMAGE} AS mls-validator
WORKDIR /src/apps/desktop/src-tauri
COPY apps/desktop/src-tauri ./
RUN cargo build --locked --release -p mls-core --bin mls-keypackage-validator

FROM ${NODE_IMAGE} AS build

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/relay ./apps/relay

RUN npm install --global npm@11.16.0 --ignore-scripts
RUN npm ci
RUN npm run build:packages
RUN npm run build -w @multaiplayer/relay
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

ENV NODE_ENV=production
ENV PORT=4321
ENV MULTAIPLAYER_RELAY_STORAGE=sqlite
ENV MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
ENV MULTAIPLAYER_MLS_VALIDATOR_PATH=/app/bin/mls-keypackage-validator

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/relay/package.json ./apps/relay/package.json
COPY --from=build /app/apps/relay/node_modules ./apps/relay/node_modules
COPY --from=build /app/apps/relay/dist ./apps/relay/dist
COPY --from=mls-validator /src/apps/desktop/src-tauri/target/release/mls-keypackage-validator /app/bin/mls-keypackage-validator

RUN node --input-type=module -e "await import('./apps/relay/dist/auth/session.js')"
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4321') + '/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "-w", "@multaiplayer/relay"]
