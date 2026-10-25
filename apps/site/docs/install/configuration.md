---
title: Configuration
description: "Reference for the Torsher container: environment variables, volumes and ports. Everything else is set in the control panel."
---

# Configuration

Torsher keeps its settings in the database and changes them in the control panel. The container needs only a few values to start, listed here.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID`, `PGID` | `1000` | Owner of the files Torsher writes to `/data` |
| `TZ` | `Etc/UTC` | Time zone |
| `TORSHER_SECRET` | key file in `/data/db` | Key that encrypts indexer API keys in the database |
| `SECRET_KEY` | key file in `/data/db` | Key that signs sign-in sessions. If you set it, use a random string of at least 32 characters (`openssl rand -hex 32`): the server refuses to start with a shorter one |
| `TMDB_ACCESS_TOKEN` | app key built into the image | Your own TMDB API Read Access Token for the catalog instead of the app key. A key set in <Ui k="panel.nav.settings panel.settings.nav.metadata" /> takes precedence over both |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | — | Your proxy for outgoing requests until the default route is changed in <Ui k="panel.nav.settings panel.settings.nav.network" /> |
| `API_PORT` | `8080` | Port inside the container |
| `TRUST_PROXY` | — | Set it when Torsher runs behind a reverse proxy: the proxy's address or subnet (`172.18.0.0/16`, several separated by commas, or `loopback`, `uniquelocal`), or `true` to trust any. Without it, sign-in attempt limits and the log see every client as the proxy's address. Don't set it without a proxy: a client could then fake its own address |
| `ENGINE_PEER_PORT` | a random port chosen once | Port the torrent engine accepts peer connections on. Publish it to be reachable from outside. A port changed in <Ui k="panel.nav.settings panel.settings.nav.torrent" /> takes precedence: publish that one instead |
| `DOWNLOADS_PATH`, `LIBRARY_PATH` | `/data/torrents`, `/data/library` | Default downloads and library folders. A folder chosen in <Ui k="panel.nav.settings panel.settings.nav.storage" /> takes precedence |
| `TORSHER_SKIP_PRE_UPDATE_BACKUP` | — | Set to `1` to let an update change the database even when the backup before the update fails. Without that backup a failed update can't be undone |
| `LOG_LEVEL` | `info`, or the level chosen in the panel | `error`, `warn`, `info` or `debug`. When set, the <Ui k="panel.logs.verbose.label" /> switch in the panel is unavailable |

::: warning Keep the key files
Without `TORSHER_SECRET`, Torsher creates `/data/db/secret.key`. Losing it makes the saved indexer API keys and notification channel tokens unreadable, and you will have to enter them again. The server's own backups include this key unless you protect them with a password.
:::

## Volumes

| Path in the container | What's inside |
| --- | --- |
| `/data` | Everything Torsher writes by default. See [Docker Compose](/docs/install/docker-compose#several-disks) for several disks |
| `/data/db` | Database, key files, the log (up to 25 MB in five rotating files) and backups in `/data/db/backups` |
| `/data/torrents` | Downloads and the watch cache |
| `/data/library` | What you keep, laid out by title |
| `/storage` | Optional. A big disk for downloads and the library, with the folders chosen in <Ui k="panel.nav.settings panel.settings.nav.storage" /> |
| `/backups` | Optional. A second disk or a NAS share for backups, chosen in <Ui k="panel.nav.settings panel.settings.nav.backups" /> |
| `/media/…` | Your existing folders, mounted read-only (`:ro`) and added in <Ui k="panel.nav.library" /> |

## Ports

| Port | What for |
| --- | --- |
| `8080` | The showcase at `/`, the control panel at `/panel/` and the API at `/api` |
| `ENGINE_PEER_PORT` | Optional. Incoming connections from torrent peers |

## Health check

The server answers `GET /api/health`, and the image uses it for the Docker health check.
