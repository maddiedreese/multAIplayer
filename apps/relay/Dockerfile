ARG NODE_IMAGE=node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d
ARG RUST_IMAGE=rust:1.89-bookworm@sha256:948f9b08a66e7fe01b03a98ef1c7568292e07ec2e4fe90d88c07bb14563c84ff
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
COPY packages/protocol ./packages/protocol
COPY apps/relay ./apps/relay
COPY tools/release/relay-runtime-dependency-closure.mjs ./tools/release/relay-runtime-dependency-closure.mjs

RUN npm install --global npm@11.16.0 --ignore-scripts
RUN npm ci --workspace @multaiplayer/relay --include-workspace-root
RUN npm run build -w @multaiplayer/protocol
RUN npm run build -w @multaiplayer/relay
RUN npm prune --omit=dev
RUN npm ls --omit=dev --all --json -w @multaiplayer/relay > /tmp/relay-production-tree.json && \
  node tools/release/relay-runtime-dependency-closure.mjs \
    prune node_modules relay-runtime-dependencies.json /tmp/relay-production-tree.json

FROM ${NODE_IMAGE} AS runtime

ARG SOURCE_DATE_EPOCH
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

ENV NODE_ENV=production
ENV PORT=4321
ENV MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite
ENV MULTAIPLAYER_MLS_VALIDATOR_PATH=/app/bin/mls-keypackage-validator

WORKDIR /app

# The production image executes Node directly and does not need npm. Removing
# the bundled package manager also removes its independent dependency tree from
# the relay's runtime attack surface.
RUN rm -rf /usr/local/lib/node_modules/npm && \
    rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/relay-runtime-dependencies.json ./relay-runtime-dependencies.json
COPY --from=build /app/tools/release/relay-runtime-dependency-closure.mjs ./tools/release/relay-runtime-dependency-closure.mjs
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/apps/relay/package.json ./apps/relay/package.json
COPY --from=build /app/apps/relay/node_modules ./apps/relay/node_modules
COPY --from=build /app/apps/relay/dist ./apps/relay/dist
COPY --from=mls-validator /src/apps/desktop/src-tauri/target/release/mls-keypackage-validator /app/bin/mls-keypackage-validator

RUN node tools/release/relay-runtime-dependency-closure.mjs \
      verify node_modules relay-runtime-dependencies.json && \
    node --input-type=module -e "await import('./apps/relay/dist/auth/session.js')"
RUN mkdir -p /data && chown node:node /data

USER node

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4321') + '/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "apps/relay/dist/production-entrypoint.js"]
