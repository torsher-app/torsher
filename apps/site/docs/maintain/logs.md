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

Open <Ui k="panel.nav.logs" /> to see recent server events. Filter by level or source, search for text, and pause live updates while you read. Select an entry to inspect or copy its details. See [the panel guide](/docs/panel/logs) for the available filters.

To ask for help, choose <Ui k="panel.logs.download.menu panel.logs.report.action" />. The report brings together technical details and the available action, playback and error history. You do not need to enable verbose logs first. [Read about its contents and privacy](/docs/panel/logs#download-a-problem-report).

<Ui k="panel.logs.download.menu panel.logs.download.action" /> downloads the regular server log as `torsher-<date>.log`, including entries that may no longer be visible in the panel.

### See more detail

By default, the log keeps information, warnings and errors. To find a problem that doesn't show there, open the <Ui k="panel.logs.more" /> menu and turn on <Ui k="panel.logs.verbose.label" />: it also records requests and internal steps. Reproduce the problem, download the log, and turn it off again.

If the `LOG_LEVEL` variable is set in `docker-compose.yml`, it decides the level and the switch is unavailable. See [Configuration](/docs/install/configuration).

## Where the log is kept

The server writes its log to `/data/db/logs`: up to 25 MiB in five rotating files, kept across restarts. The panel and exports cover up to seven days; size limits can remove history sooner. API keys, tokens, passwords and paths inside the downloads folder are masked before an entry is written.

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

1. What you did, what you expected and what happened instead. Give the approximate time if you know it.
2. The file from <Ui k="panel.logs.download.menu panel.logs.report.action" />. Available versions and technical details are already included.

If the report option is unavailable, attach the regular log and the version from <Ui k="panel.nav.settings panel.settings.nav.about" />. If the panel cannot open, use the container log above. Include your device model or network setup if it seems relevant: the report cannot identify every part of your setup.

::: info Review the file before sharing it
Reports can reveal viewing activity, and regular logs contain more detailed server messages. Check the file before attaching it to a public issue. Share only what you are comfortable making public.
:::

## Next

- [Troubleshooting](/docs/troubleshooting): fixes for common problems.
