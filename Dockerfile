# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.21.0

# Торрент-движок: закреплённый релиз, суммы — те же, что в
# apps/server/src/services/engine/release.ts (сверяет тест release.test.ts)
FROM scratch AS rqbit-amd64
ADD --checksum=sha256:82ed2c23f4c7b91bb2c92eaab92e4a850d386cdf337bcdf9e0971c8ce3da4335 \
    --chmod=755 \
    https://github.com/ikatson/rqbit/releases/download/v9.0.1/rqbit-linux-amd64 /rqbit

FROM scratch AS rqbit-arm64
ADD --checksum=sha256:9ac50a7d1917cd458111265a12346a924b4f7cea7520327782ed5bd6f423b561 \
    --chmod=755 \
    https://github.com/ikatson/rqbit/releases/download/v9.0.1/rqbit-linux-arm64 /rqbit

FROM rqbit-${TARGETARCH} AS rqbit

# Сборка идёт на платформе сборщика: фронтенды — платформенно-независимая
# статика, а зависимости сервера ставятся под целевую архитектуру флагами
# pnpm (better-sqlite3 и argon2 приходят готовыми бинарниками), поэтому
# эмуляция чужой архитектуры при сборке не нужна
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 \
    CI=true
RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm fetch

COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline \
 && pnpm --filter @torsher/tv --filter @torsher/web build

ARG TARGETARCH
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    case "$TARGETARCH" in \
      amd64) cpu=x64 ;; \
      arm64) cpu=arm64 ;; \
      *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && pnpm --filter @torsher/server deploy --prod \
      --cpu="$cpu" --os=linux --libc=glibc /out/server \
 && cd /out/server \
 && find src -name '*.test.ts' -delete \
 && rm -rf src/services/*/fixtures \
 # Исходники SQLite и бинарники под другие платформы рантайму не нужны
 && sqlite=$(echo node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3) \
 && rm -rf "$sqlite/deps" "$sqlite/src" \
 && find "$sqlite/prebuilds" -type f ! -name "linux-$cpu.node" -delete

FROM node:${NODE_VERSION}-bookworm-slim

# ca-certificates — для движка: Node несёт свои корневые сертификаты, а rqbit
# берёт системные
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    API_PORT=8080 \
    DATABASE_PATH=/data/db/torsher.db \
    DOWNLOADS_PATH=/data/torrents \
    RQBIT_PATH=/usr/local/bin/rqbit \
    PUID=1000 \
    PGID=1000

WORKDIR /app
# Те же относительные пути, что в монорепо: сервер находит витрину и панель
# в ../tv/dist и ../web/.output/public
COPY --from=build /out/server/package.json server/package.json
COPY --from=build /out/server/node_modules server/node_modules
COPY --from=build /out/server/src server/src
COPY --from=build /src/apps/tv/dist tv/dist
COPY --from=build /src/apps/web/.output/public web/.output/public
COPY --from=rqbit /rqbit /usr/local/bin/rqbit
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/torsher-entrypoint

ARG TORSHER_COMMIT=""
ENV TORSHER_COMMIT=$TORSHER_COMMIT

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--", "torsher-entrypoint"]
CMD ["node", "server/src/main.ts"]
