---
title: Logs
description: "The server log in the panel: levels, sources, search, live updates, verbose logs and downloading the log for a bug report."
---

# Logs

<Ui k="panel.nav.logs" /> shows what the server, the torrent engine and playback are doing, newest first, as it happens. Look here when something doesn't work and the panel doesn't say why.

::: tip What you'll learn
What the page shows and how to narrow it down. How to collect a log for a bug report is in [Logs and diagnostics](/docs/maintain/logs).
:::

## The list

Entries are grouped by day. A red mark is an error, a yellow one is a warning. An entry that repeats is shown once with how many times it repeated. Click an entry to see its time, source, level and details, and to copy it.

The page keeps only recent entries. Earlier ones are in the downloaded log.

## Narrow it down

- **Level:** <Ui k="panel.logs.filters.all" />, <Ui k="panel.logs.filters.warn" /> or <Ui k="panel.logs.filters.error" />.
- **<Ui k="panel.logs.filters.source" />:** one part of the server, such as <Ui k="panel.logs.sources.engine" />, <Ui k="panel.logs.sources.playback" />, <Ui k="panel.logs.sources.sources" />, <Ui k="panel.logs.sources.network" /> or <Ui k="panel.logs.sources.backups" />.
- **Search** in messages.
- **<Ui k="panel.logs.filters.pause" />** stops live updates while you read, <Ui k="panel.logs.filters.resume" /> starts them again.

When you scroll down the list, new entries don't push it: a button at the top says how many arrived and brings them in.

A problem in <Ui k="panel.nav.overview" /> about engine crashes opens this page already filtered to the engine's warnings.

## Download and verbose logs

- **<Ui k="panel.logs.download.action" />** saves the whole log as a text file.
- **<Ui k="panel.logs.verbose.label" />,** in the <Ui k="panel.logs.more" /> menu, also records requests and internal steps. Turn it on, reproduce the problem, download the log, and turn it off again. When the `LOG_LEVEL` variable is set, it decides the level and the switch is unavailable.

See [Logs and diagnostics](/docs/maintain/logs) for where the log is kept, the container log, and what to put in a bug report.

## Next

- [Settings](/docs/panel/settings).
- [Troubleshooting](/docs/troubleshooting).
