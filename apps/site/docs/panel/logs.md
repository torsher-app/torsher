---
title: Logs
description: "Read and filter server logs, download a problem report, and manage viewer action diagnostics."
---

# Logs

<Ui k="panel.nav.logs" /> shows what the server, the torrent engine and playback are doing, newest first, as it happens. Look here when something doesn't work and the panel doesn't say why.

::: tip What you'll learn
What the page shows and how to narrow it down. How to collect a log for a bug report is in [Logs and diagnostics](/docs/maintain/logs).
:::

## The list

Entries are grouped by day. A red mark is an error, a yellow one is a warning. An entry that repeats is shown once with how many times it repeated. Click an entry to see its time, source, level and details, and to copy it.

The page shows recent entries. The downloaded log may include older ones that are no longer visible in the list.

## Follow one case

Entries name torrents by their info hash and playback by a session id, not by file or release names. In an entry's card, click an id to see every entry with it: for one viewing, that's the engine, the playback decision, transcoding and the player's error together.

Open <Ui k="panel.nav.logs" /> from a download's menu or card to find its info hash across all levels and sources. You can also copy the info hash from the card.

Engine entries include network settings at startup, metadata timeouts, reads stalled for at least ten seconds, recovery when a read returns bytes, API errors and storage write failures. A stalled read can be waiting for peers, disk IO or an internal lock. Available peer counts and download speed are sampled facts with an age; they do not prove why the read is waiting. Repeated failures are limited to keep the journal readable.

An indexer’s menu and card also open <Ui k="panel.nav.logs" /> with its id. The same menu is available on phones. Search summaries show how many indexers were contacted, answered successfully, failed or were skipped, and how many distinct results remained after matching. One indexer can receive several queries but is counted once. An empty successful answer is different from a failed search. Cache hits appear in verbose logs; they can reuse an earlier failed result. Backoff entries show when repeated failures pause an indexer and when a successful search clears that pause.

Storage entries explain when metadata could not be fetched, a file cannot start because of disk space or cache limits, or a selected folder was rejected. They show the relevant download id, space figures or a safe error category, without file names or folder paths. Repeated polling failures are limited so they do not fill the journal.

A followed title’s card opens <Ui k="panel.nav.logs" /> for that title. Follow summaries show planned actions, waiting episodes and rejected candidates; the common rejection codes explain the result. A separate entry confirms a download actually started. Postponed searches show the next check time when the title is unavailable, indexers are paused or the next release has not arrived.

## Narrow it down

- **Level:** <Ui k="panel.logs.filters.all" />, <Ui k="panel.logs.filters.warn" /> or <Ui k="panel.logs.filters.error" />.
- **<Ui k="panel.logs.filters.source" />:** one part of the server, such as <Ui k="panel.logs.sources.engine" />, <Ui k="panel.logs.sources.playback" />, <Ui k="panel.logs.sources.sources" />, <Ui k="panel.logs.sources.network" /> or <Ui k="panel.logs.sources.backups" />.
- **Search** in messages and in the ids an entry carries: a torrent's info hash, a playback session, a title.
- **<Ui k="panel.logs.filters.pause" />** stops live updates while you read, <Ui k="panel.logs.filters.resume" /> starts them again.

When you scroll down the list, new entries don't push it: a button at the top says how many arrived and brings them in.

A problem in <Ui k="panel.nav.overview" /> about engine crashes opens this page already filtered to the engine's warnings.

## Download a problem report

Choose <Ui k="panel.logs.download.menu panel.logs.report.action" /> when you need help with a problem. It saves one text file containing:

- Server and app versions, along with available device and playback details.
- Recent viewer actions, such as choosing what to watch, seeking and moving to the next episode.
- Errors and related server events, grouped to help follow what happened.

The report includes available history from the last seven days. Older entries can be removed sooner if the log fills up. If some history could not be included, the download shows a warning and the file explains what is missing. Some device details may also be unavailable.

Only the server owner can download reports. Nothing is sent automatically. Passwords, typed input, file names and raw error messages are excluded, but episode numbers and playback positions can reveal viewing activity. Review the file before sharing it.

You do not need to enable verbose logs to create a report. If the report option is missing on an older server, download the regular log instead. See [what to include in a bug report](/docs/maintain/logs#what-to-put-in-a-bug-report).

## Regular and verbose logs

<Ui k="panel.logs.download.menu panel.logs.download.action" /> saves the regular log. Use it when you want to read the server's messages or have been asked for more detail about a problem.

<Ui k="panel.logs.verbose.label" /> in the <Ui k="panel.logs.more" /> menu adds requests and internal steps to new entries. Turn it on before reproducing a problem, then turn it off again. See [how to collect more detail](/docs/maintain/logs#see-more-detail), including what to do when the switch is unavailable.

Pairing, sign-in and access failures are also recorded with safe reasons. Device menus have <Ui k="panel.nav.logs" /> to find related entries. Pairing codes, tokens and device names are excluded from these messages.

## Viewer action diagnostics

<Ui k="panel.logs.diagnostics.label" /> in the <Ui k="panel.logs.more" /> menu is on by default. It records actions from the TV showcase on your own server, helping explain problems such as resuming at the wrong position or choosing an unexpected next episode.

Turn it off to stop recording new viewer actions. Regular engine and server diagnostics continue to be recorded. Existing entries and previously downloaded files are kept. A brief notification confirms the change; the checkbox shows the current setting.

To inspect these events, select <Ui k="panel.logs.sources.client" /> in the source filter. Click an entry's id to follow related events. <Ui k="panel.logs.diagnostics.duplicate" /> means the same event was delivered again, rather than another action by the viewer.

Warnings above the list explain when collection or storage is not working, or when events are missing. A report can help reconstruct a problem, but it may not contain every action before a connection failure or sudden shutdown.

## Next

- [Settings](/docs/panel/settings).
- [Troubleshooting](/docs/troubleshooting).
