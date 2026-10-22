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

4. Open `http://<host>:8080/panel/` and create the owner account. The server has one account. A setup wizard then checks storage, network access to TMDB and looks for Prowlarr or Jackett nearby; every step can be skipped.
5. Open `http://<host>:8080/` on a TV or in a browser to use the showcase.

Updating is `docker compose pull && docker compose up -d`. Database migrations run on start.

### Sources

Torsher comes without any sources. Connect any Torznab indexer, for example Prowlarr or Jackett. The setup wizard finds a manager at its usual address (a compose service named `prowlarr` or `jackett`, the Docker host, this machine) and connects it with the API key. Later, in the panel open **Sources** and choose **Import from Prowlarr or Jackett** (address and API key) or **Add manually** for a single Torznab indexer.

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
| `TMDB_ACCESS_TOKEN` | — | TMDB API Read Access Token for the catalog; a key set in Settings → Metadata takes precedence |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | — | Your proxy for outgoing requests until the default route is changed in Settings → Network |
| `API_PORT` | `8080` | Port inside the container |
| `ENGINE_PEER_PORT` | any free port | Port the torrent engine accepts peer connections on; publish it to be reachable from outside |
| `LOG_LEVEL` | level chosen in the panel, `info` | Log level: `error`, `warn`, `info` or `debug`. When set, the **Verbose logs** switch in the panel is unavailable |

### Data

Everything lives in the `/data` volume. `/data/db` holds the database and the key files (`secret.key`, `session.key`): back it up together. Losing `secret.key` makes the saved indexer API keys unreadable, and you will have to enter them again.

`/data/db/logs` holds the server log: up to 25 MB in five rotating files, kept across restarts. Secrets and paths inside the downloads folder are masked before an entry is written. The panel shows recent entries under **Logs**, and **Download logs** there saves the whole log as a text file to attach to a bug report.

The server exposes `GET /api/health`, and the image uses it for the Docker health check.

### Forgot password

The server has one account and sends no email, so the password is reset with a command inside the container:

```bash
docker exec -it torsher torsher reset-password
```

It prints a new random password and signs out every browser and device. To set your own password instead, pass it on standard input:

```bash
printf '%s' 'new password' | docker exec -i torsher torsher reset-password --stdin
```

Change the password afterwards in the panel under **Settings → Account**. Use your container name in place of the first `torsher` if it differs.

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

Audio and subtitle tracks, and remuxing files a browser cannot play directly (MKV, AC3), need `ffmpeg` and `ffprobe` in `PATH`, or their paths in `FFMPEG_PATH` and `FFPROBE_PATH`. Without them the player plays files directly. The image ships FFmpeg from Debian.

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
