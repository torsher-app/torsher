---
title: Logs and diagnostics
description: "Find out what went wrong: the log in the control panel, the container log, the health check, and what to attach to a bug report."
---

# Logs and diagnostics

When something doesn't work, the server usually says why in its log. This page shows where to read it and what to send with a bug report.

::: tip What you'll learn
Where the server writes what it does, how to see more detail, and how to tell whether the container is healthy.
:::

## The log in the panel

Open <Ui k="panel.nav.logs" />. The newest entries are at the top and new ones appear as they happen.

- <Ui k="panel.logs.filters.all" />, <Ui k="panel.logs.filters.warn" /> and <Ui k="panel.logs.filters.error" /> narrow the list by level.
- <Ui k="panel.logs.filters.source" /> shows one part of the server, for example <Ui k="panel.logs.sources.engine" />, <Ui k="panel.logs.sources.playback" />, <Ui k="panel.logs.sources.sources" /> or <Ui k="panel.logs.sources.network" />.
- <Ui k="panel.logs.filters.search" /> finds text in messages.
- <Ui k="panel.logs.filters.pause" /> stops live updates while you read.

Select an entry to see its details and <Ui k="panel.logs.card.copy" />.

The panel shows recent entries. <Ui k="panel.logs.download.action" /> saves the whole log as a text file, `torsher-<date>.log`.

### See more detail

By default, the log keeps information, warnings and errors. To find a problem that doesn't show there, open the <Ui k="panel.logs.more" /> menu next to <Ui k="panel.logs.download.action" /> and turn on <Ui k="panel.logs.verbose.label" />: it also records requests and internal steps. Reproduce the problem, download the log, and turn it off again.

If the `LOG_LEVEL` variable is set in `docker-compose.yml`, it decides the level and the switch is unavailable. See [Configuration](/docs/install/configuration).

## Where the log is kept

The server writes its log to `/data/db/logs`: up to 25 MB in five rotating files, kept across restarts. API keys, tokens, passwords and paths inside the downloads folder are masked before an entry is written.

## The container log

When the panel doesn't open, read the container's own output. It has what the server prints on start, including why it refused to start:

```bash
docker compose logs --tail 200 torsher
```

Run it in the folder with your `docker-compose.yml`. Add `-f` to follow new lines; press `Ctrl+C` to stop.

Without Docker Compose:

```bash
docker logs --tail 200 torsher
```

## The health check

The server answers `GET /api/health` with `{"status":"ok"}`, and the image uses it for the Docker health check every 30 seconds. See the status:

```bash
docker compose ps
```

`healthy` means the server is up and answering. `unhealthy` or a container that keeps restarting means it fails on start: read the container log.

From another device in your network, open `http://<server-address>:8080/api/health` in a browser. If it doesn't load while the container is healthy, the problem is the network between that device and the server: the address, the port or a firewall.

## What to put in a bug report

Report problems on [GitHub Issues](https://github.com/torsher-app/torsher/issues). Include:

1. The version and commit from <Ui k="panel.nav.settings panel.settings.nav.about" />.
2. Where Torsher runs: the machine, the operating system, the Docker version (`docker version`), and whether it is behind a reverse proxy.
3. The device you watch on, if the problem is with playback or a TV.
4. What you did, what you expected and what happened instead.
5. The log file from <Ui k="panel.logs.download.action" />, ideally with <Ui k="panel.logs.verbose.label" /> on while you reproduce the problem.

::: info Look through the log before you post it
Secrets are masked, but the log can still contain titles you watched, release names and the addresses of your devices. Remove what you don't want to share in a public issue.
:::

## Next

- [Troubleshooting](/docs/troubleshooting): fixes for common problems.
