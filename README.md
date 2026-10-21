# Torsher

Self-hosted media center in a single Docker container: browse a catalog, start watching a torrent right away, keep what you watched in your own library, and let new episodes arrive on their own.

Torsher combines a BitTorrent client, a media library and series automation with a TV-first interface. It ships no indexers or content: you connect the sources you are allowed to use.

## Status

Early development. Nothing here is ready for use yet.

## Install

Torsher runs as a single Docker container on x86-64 and arm64 Linux: a mini PC, a NAS or a desktop. Docker Desktop on macOS and Windows works too.

1. Copy [`docker-compose.example.yml`](docker-compose.example.yml) into an empty folder as `docker-compose.yml`.
2. Set `PUID` and `PGID` to the user that should own the files in `./data` (`id -u` and `id -g` on the host).
3. Start it:

   ```bash
   docker compose up -d
   ```

4. Open `http://<host>:8080/panel/` and create the owner account. The server has one account.
5. Open `http://<host>:8080/` on a TV or in a browser to use the showcase.

Updating is `docker compose pull && docker compose up -d`. Database migrations run on start.

### Sources

Torsher comes without any sources. Connect any Torznab indexer, for example Prowlarr or Jackett: in the panel open **Sources** and choose **Import from Prowlarr or Jackett** (address and API key) or **Add manually** for a single Torznab indexer.

The example file has an optional Prowlarr service. It starts empty, and you add the indexers you are allowed to use:

```bash
docker compose --profile prowlarr up -d
```

Prowlarr is then at `http://<host>:9696`, and Torsher reaches it as `http://prowlarr:9696`.

### Configuration

Everything except the values below is set in the panel.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID`, `PGID` | `1000` | Owner of the files Torsher writes to `/data` |
| `TZ` | `Etc/UTC` | Time zone |
| `TORSHER_SECRET` | key file in `/data/db` | Key that encrypts indexer API keys in the database |
| `SECRET_KEY` | key file in `/data/db` | Key that signs sign-in sessions |
| `TMDB_ACCESS_TOKEN` | — | TMDB API Read Access Token for the catalog |
| `API_PORT` | `8080` | Port inside the container |
| `ENGINE_PEER_PORT` | any free port | Port the torrent engine accepts peer connections on; publish it to be reachable from outside |

### Data

Everything lives in the `/data` volume. `/data/db` holds the database and the key files (`secret.key`, `session.key`): back it up together. Losing `secret.key` makes the saved indexer API keys unreadable, and you will have to enter them again.

The server exposes `GET /api/health`, and the image uses it for the Docker health check.

## Development

Requires Node.js 24 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Streaming needs the torrent engine in `engine/` (Go, built on [anacrolix/torrent](https://github.com/anacrolix/torrent)). With Go 1.24+ installed, `pnpm dev` builds it into the server data folder on start; without Go, the server starts without it. To build it separately:

```bash
pnpm --filter @torsher/server engine:build
```

To use a prebuilt binary instead, set `ENGINE_PATH` in `apps/server/.env`.

`pnpm dev` starts the server, the panel and the showcase with hot reload. `pnpm build` builds the showcase and the panel, which the server then serves itself: the showcase at `/`, the panel at `/panel/` and the API at `/api`.

Build the image locally:

```bash
docker buildx build --platform linux/arm64 -t torsher:dev --load .
```

## Disclaimer

Torsher does not include, host or index any content. You choose the sources you connect and are responsible for making sure you are allowed to use them.

## Contributing

Issues and bug reports are welcome. Pull requests to this repository are not accepted.

## License

[AGPL-3.0-only](LICENSE) © 2026-present, [Anton Reshetov](https://github.com/antonreshetov)
