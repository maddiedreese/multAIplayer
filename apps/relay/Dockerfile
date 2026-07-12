ARG NODE_IMAGE=node:24-bookworm-slim@sha256:cb4e8f7c443347358b7875e717c29e27bf9befc8f5a26cf18af3c3dec80e58c5
FROM ${NODE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/relay ./apps/relay

RUN npm ci
RUN npm run build:packages
RUN npm run build -w @multaiplayer/relay
RUN npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production
ENV PORT=4321
ENV MULTAIPLAYER_RELAY_STORAGE=sqlite
ENV MULTAIPLAYER_RELAY_DATA_PATH=/data/relay-store.sqlite

WORKDIR /app

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/relay/package.json ./apps/relay/package.json
COPY --from=build /app/apps/relay/dist ./apps/relay/dist

RUN mkdir -p /data

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '4321') + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "run", "start", "-w", "@multaiplayer/relay"]
