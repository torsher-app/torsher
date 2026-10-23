# syntax=docker/dockerfile:1

ARG NODE_VERSION=24.21.0
ARG GO_VERSION=1.24

# Торрент-движок (engine/, Go): собирается на платформе сборщика под целевую
# архитектуру без cgo — статический бинарник, эмуляция не нужна. Лицензии
# всех вошедших в него Go-модулей кладутся рядом
FROM --platform=$BUILDPLATFORM golang:${GO_VERSION}-bookworm AS engine
ARG TARGETARCH
WORKDIR /src
COPY engine/go.mod engine/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY engine/ ./
ENV CGO_ENABLED=0 GOOS=linux
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/torsher-engine . \
 && GOARCH=$TARGETARCH go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Dir}}{{end}}{{end}}' . \
    | sort -u \
    | while read -r module dir; do \
        mkdir -p "/out/licenses/$module" \
        && find "$dir" -maxdepth 1 -type f \( -iname 'license*' -o -iname 'licence*' -o -iname 'copying*' -o -iname 'notice*' \) \
             -exec cp {} "/out/licenses/$module/" \; ; \
      done

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
 && find "$sqlite/prebuilds" -type f ! -name "linux-$cpu.node" -delete \
 # Node не снимает типы с .ts внутри node_modules: пакеты монорепо на TS лежат
 # рядом с сервером, а в node_modules остаётся ссылка на них
 && mkdir -p /out/packages/release-parser \
 && cp -r /src/packages/release-parser/package.json /src/packages/release-parser/src /out/packages/release-parser/ \
 && find /out/packages -name '*.test.ts' -delete \
 && rm -rf node_modules/@torsher/release-parser \
 && ln -s ../../../packages/release-parser node_modules/@torsher/release-parser

# trixie, а не bookworm: ffmpeg из Debian (перепаковка видео и ffprobe) там
# 7.1, в bookworm — 5.1. Пакет Debian собран без несвободных частей
FROM node:${NODE_VERSION}-trixie-slim

# ca-certificates — для движка: Node несёт свои корневые сертификаты, а движок
# на Go берёт системные (HTTPS-трекеры).
# Драйверы видеокарт для перекодирования — свободные, из main: VAAPI Intel
# (сборка Free Kernel, есть только под amd64) и AMD (mesa), Vulkan для HDR → SDR
# в libplacebo. Программный Vulkan (lavapipe) убран: на нём libplacebo
# считал бы процессором, а детект принял бы его за видеокарту. Драйвер NVIDIA
# в контейнер монтирует NVIDIA Container Toolkit хоста
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates ffmpeg \
      mesa-va-drivers mesa-vulkan-drivers \
      $([ "$TARGETARCH" = amd64 ] && echo intel-media-va-driver) \
 && rm -f /usr/share/vulkan/icd.d/lvp_icd*.json \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    API_PORT=8080 \
    DATABASE_PATH=/data/db/torsher.db \
    DOWNLOADS_PATH=/data/torrents \
    LIBRARY_PATH=/data/library \
    ENGINE_PATH=/usr/local/bin/torsher-engine \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,video,utility,graphics \
    PUID=1000 \
    PGID=1000

WORKDIR /app
# Те же относительные пути, что в монорепо: сервер находит витрину и панель
# в ../tv/dist и ../web/.output/public
COPY --from=build /out/server/package.json server/package.json
COPY --from=build /out/server/node_modules server/node_modules
COPY --from=build /out/server/src server/src
COPY --from=build /out/packages packages
COPY --from=build /src/apps/tv/dist tv/dist
COPY --from=build /src/apps/web/.output/public web/.output/public
COPY --from=engine /out/torsher-engine /usr/local/bin/torsher-engine
COPY --from=engine /out/licenses /usr/share/licenses/torsher-engine
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/torsher-entrypoint
COPY --chmod=755 docker/torsher.sh /usr/local/bin/torsher

ARG TORSHER_COMMIT=""
ENV TORSHER_COMMIT=$TORSHER_COMMIT

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 8080) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["tini", "--", "torsher-entrypoint"]
CMD ["node", "server/src/main.ts"]
