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
| `SECRET_KEY` | key file in `/data/db` | Key that signs sign-in sessions |
| `TMDB_ACCESS_TOKEN` | — | TMDB API Read Access Token for the catalog. A key set in <Ui k="panel.nav.settings panel.settings.nav.metadata" /> takes precedence |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | — | Your proxy for outgoing requests until the default route is changed in <Ui k="panel.nav.settings panel.settings.nav.network" /> |
| `API_PORT` | `8080` | Port inside the container |
| `ENGINE_PEER_PORT` | any free port | Port the torrent engine accepts peer connections on. Publish it to be reachable from outside |
| `LOG_LEVEL` | `info`, or the level chosen in the panel | `error`, `warn`, `info` or `debug`. When set, the <Ui k="panel.logs.verbose.label" /> switch in the panel is unavailable |

::: warning Keep the key files
Without `TORSHER_SECRET`, Torsher creates `/data/db/secret.key`. Losing it makes the saved indexer API keys unreadable, and you will have to enter them again. Back up `/data/db` as a whole.
:::

## Volumes

| Path in the container | What's inside |
| --- | --- |
| `/data` | Everything Torsher writes. Keep it one volume, see [Docker Compose](/docs/install/docker-compose#several-disks) |
| `/data/db` | Database, key files and the log (up to 25 MB in five rotating files) |
| `/data/torrents` | Downloads and the watch cache |
| `/data/library` | What you keep, laid out by title |
| `/media/…` | Your existing folders, mounted read-only (`:ro`) and added in <Ui k="panel.nav.library" /> |

## Ports

| Port | What for |
| --- | --- |
| `8080` | The showcase at `/`, the control panel at `/panel/` and the API at `/api` |
| `ENGINE_PEER_PORT` | Optional. Incoming connections from torrent peers |

## Health check

The server answers `GET /api/health`, and the image uses it for the Docker health check.
