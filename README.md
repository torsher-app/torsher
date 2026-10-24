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
| `TORSHER_SKIP_PRE_UPDATE_BACKUP` | — | Set to `1` to let an update change the database even when the backup before the update fails. Without a backup a failed update can't be undone |

### Hardware transcoding

When a player can't decode a video (old Xvid/DivX AVI files, HEVC or 10-bit video in a browser, HDR, image subtitles), the server transcodes it to H.264 on the fly. It uses a GPU when the container can see one and the CPU otherwise. **Settings → Playback** in the panel shows what was found.

- **Intel and AMD (VAAPI).** Uncomment `devices: /dev/dri` in the compose file. Intel graphics from Tiger Lake onwards (including N100 and N150) encode in low-power mode only; this needs the GuC/HuC firmware on the host (`firmware-intel-graphics` on Debian, `linux-firmware` elsewhere) and, on Alder Lake-N, Linux 6.2 or later.
- **NVIDIA (NVENC).** Install the NVIDIA driver and the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host and uncomment the NVIDIA block in the compose file.
- **CPU.** Always available. The server measures the CPU on start and scales larger video down to 1080p, 720p or 576p to keep up with playback.

Docker Desktop on macOS and Windows does not pass a GPU into Linux containers: transcoding runs on the CPU there.

### Data

Everything lives in the `/data` volume. `/data/torrents` holds downloads, `/data/library` holds the files you keep, laid out by title (`movies/Title (2010) [tmdbid-27205]/…`, `shows/Title (2008) [tmdbid-1396]/Season 01/…`) so Jellyfin, Plex and Kodi can read it too. A kept file is hard-linked from downloads, so it keeps seeding without taking extra space; this needs both folders in one volume. Otherwise the file is copied, and the panel warns about it. `/data/db` holds the database and the key files (`secret.key`, `session.key`): back it up together. Losing `secret.key` makes the saved indexer API keys unreadable, and you will have to enter them again.

`/data/db/logs` holds the server log: up to 25 MB in five rotating files, kept across restarts. Secrets and paths inside the downloads folder are masked before an entry is written. The panel shows recent entries under **Logs**, and **Download logs** there saves the whole log as a text file to attach to a bug report.

The server exposes `GET /api/health`, and the image uses it for the Docker health check.

### Updating

Once a day the server checks the releases of its source repository on GitHub and shows **Version X is available** on the overview and under **Settings → About**, with the highlights of the release notes. The request carries no identifiers and no data about the server; turn it off under **Settings → About**. The **Beta** channel there also offers pre-releases.

The container doesn't update itself. Run in the folder with your `docker-compose.yml`:

```bash
docker compose pull
```

```bash
docker compose up -d
```

Docker replaces the container and keeps the `/data` volume. If the `image:` line names a version (`ghcr.io/torsher-app/torsher:0.3.0`), change it to the new one first; `:latest` follows stable releases and `:beta` follows every release. With `docker run`, stop and remove the container, `docker pull` the image and start it again with the same volumes. Tools that update containers automatically work too, but an update restarts the server and interrupts playback, so we recommend updating by hand when nobody is watching.

### Notifications

The bell in the panel shows server problems (the same as **Needs attention**), new versions, finished downloads and new devices. To get them when the panel is closed, add a channel under **Settings → Notifications**: Telegram, a webhook (Discord, Slack or JSON for your own receiver), ntfy, Gotify, email over SMTP, or your own `apprise-api` server for anything else. Each channel chooses its events and language and has **Send test**. A problem is reported once when it appears and, if you ask for it, once when it is resolved; a channel gets at most 20 messages an hour.

Messages go through the routes in **Settings → Network**, so a channel that is only reachable through a proxy works once its host has a route. Tokens and passwords of channels are encrypted with `TORSHER_SECRET` like indexer keys.

### Forgot password

The server has one account and doesn't send password reset emails, so the password is reset with a command inside the container:

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
