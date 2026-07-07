FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/relay ./apps/relay

RUN npm ci
RUN npm run build:packages
RUN npm run build -w @multaiplayer/relay
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

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
