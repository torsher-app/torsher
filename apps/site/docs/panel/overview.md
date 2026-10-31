---
title: Overview
description: "The first page of the control panel: problems that need attention, a new version, and the state of downloads, storage, sources, devices, playback and backups."
---

# Overview

<Ui k="panel.nav.overview" /> is the first page of the control panel. It answers one question: is the server fine, and if not, where do you fix it.

::: tip What you'll learn
What each part of the overview means, where each problem leads, and what the sidebar and the bell tell you on every page.
:::

## The header

Next to the page title, the panel shows how long the server has been running and the Torsher version. The version is also in <Ui k="panel.nav.settings panel.settings.nav.about" />.

## A new version

When a newer release is out, a card at the top says which version is available, when it was released and what's new in it.

- <Ui k="panel.updates.howTo" /> opens the update command and warns you if someone is watching right now: updating restarts the server.
- <Ui k="panel.updates.whatsNew" /> opens the release notes.
- <Ui k="panel.updates.dismiss" /> hides the card until the next version comes out.

See [Update and roll back](/docs/maintain/update).

## Needs attention

<Ui k="panel.overview.attention.title" /> appears only when something is wrong. Each line is one problem: red for an error, yellow for a warning. Click it to open the place where it is fixed.

| Problem | Opens | What to do |
| --- | --- | --- |
| The torrent engine isn't installed, isn't running or crashed | <Ui k="panel.nav.torrents" />, or <Ui k="panel.nav.logs" /> for crashes | [The torrent engine isn't running](/docs/troubleshooting#engine) |
| Free space is below the reserve, or torrents are paused for lack of space | <Ui k="panel.settings.nav.storage" /> | [Not enough free space](/docs/troubleshooting#low-space) |
| Downloads and the library are on different volumes | <Ui k="panel.settings.nav.storage" /> | [Kept files are copied](/docs/troubleshooting#copies) |
| An indexer doesn't respond, rejects requests or is gone from its manager | <Ui k="panel.nav.sources" />, filtered to <Ui k="panel.sources.filters.attention" /> | [An indexer doesn't respond](/docs/troubleshooting#indexer-error) |
| DNS returns a wrong address for a host | <Ui k="panel.settings.nav.network" /> | [DNS returns a wrong address](/docs/troubleshooting#dns-spoofing) |
| A host is unreachable | <Ui k="panel.settings.nav.network" /> | [A host is unreachable](/docs/troubleshooting#host-unreachable) |
| No TMDB key, the key is rejected or can't be decrypted | <Ui k="panel.settings.nav.metadata" /> | [TMDB rejects the key](/docs/troubleshooting#tmdb-key-rejected) |
| A GPU was found but failed the test | <Ui k="panel.settings.nav.playback" /> | [A GPU was found but failed the test](/docs/troubleshooting#gpu-failed) |
| A library folder is unavailable | <Ui k="panel.nav.library" /> | [A library folder is unavailable](/docs/troubleshooting#library-offline) |
| Releases in a library folder are not recognized | <Ui k="panel.nav.library" /> | [Releases are not recognized](/docs/troubleshooting#unmatched) |
| The folder watcher didn't start | <Ui k="panel.nav.library" /> | Nothing urgent: the scan every 12 hours still picks up changes |
| A backup failed, or there is no backup for more than two days | <Ui k="panel.settings.nav.backups" /> | [No backup for more than two days](/docs/troubleshooting#backup-stale) |
| The backup folder is unavailable | <Ui k="panel.settings.nav.backups" /> | [The backup folder is unavailable](/docs/troubleshooting#backup-folder) |
| Not enough space for followed episodes, or an indexer has been limiting requests for over 6 hours | <Ui k="panel.nav.follow" /> | [Following](/docs/panel/follow#if-something-went-wrong) |

A line disappears by itself once the problem is gone. The same problems can reach you outside the panel through notification channels, see [Notifications](/docs/panel/settings#notifications).

## The tiles

Six tiles show the state of the server. Each one opens its section.

- **<Ui k="panel.nav.torrents" />.** How many torrents are downloading, the current download and upload speed, and how many torrents are in the list.
- **<Ui k="panel.settings.nav.storage" />.** Free space on the downloads disk, and how much the cache uses of its limit next to the free space reserve. The number turns red when free space drops below the reserve.
- **<Ui k="panel.nav.sources" />.** How many enabled indexers work.
- **<Ui k="panel.nav.people" />.** How many devices are connected and how many are playing something right now.
- **<Ui k="panel.settings.nav.playback" />.** What transcodes video: the GPU, the CPU only, or nothing. The footer shows up to which resolution the CPU and HDR conversion keep up. See [Hardware transcoding](/docs/install/hardware-acceleration).
- **<Ui k="panel.settings.nav.backups" />.** When the latest backup was made, and whether backups are off or failing.

## On every page

- **The sidebar.** A red number next to <Ui k="panel.nav.torrents" />, <Ui k="panel.nav.follow" /> or <Ui k="panel.nav.sources" /> counts the items there that need attention. An amber dot next to <Ui k="panel.nav.torrents" /> means something is downloading.
- **<Ui k="panel.nav.links" />.** <Ui k="panel.nav.showcase" /> opens the TV showcase in a new browser tab, <Ui k="panel.nav.docs" /> opens this site, <Ui k="panel.nav.donate" /> opens the donation page.
- **The bell.** The bell in the top bar is the notification center: problems, updates, finished downloads, new devices and followed episodes. It always gets every event, whether or not you set up channels. It shows the latest 20. Click a notification to open its section, or select <Ui k="panel.notifications.readAll" />. <Ui k="panel.notifications.viewAll" /> opens the full list grouped by day, with filters by type and for unread ones. <Ui k="panel.notifications.settingsShort" /> opens channel settings. Notifications are kept for 90 days, up to 1000; unresolved problems stay until they are resolved.
- **The account menu.** At the bottom of the sidebar: the panel <Ui k="panel.account.language" />, the <Ui k="panel.account.theme" />, <Ui k="panel.account.settings" /> and <Ui k="panel.account.logout" />.

## Notification history

Open the bell and select <Ui k="panel.notifications.viewAll" /> to browse the history grouped by day. The page loads 50 notifications at a time; <Ui k="panel.notifications.more" /> loads the next batch.

Choose a group and combine it with <Ui k="panel.notifications.feed.unread" /> to narrow the list. <Ui k="panel.notifications.feed.groups.problems" /> includes followed episodes for which no release was found. Filters stay in the page address, so reloading or sharing the link preserves your view. The unread number covers the whole history and is hidden when a group is selected.

Opening a notification marks it as read and updates the bell counter. <Ui k="panel.notifications.readAll" /> marks the entire history as read, including notifications outside the current filter. Read rows stay in place until the list reloads.

## If something went wrong

**<Ui k="panel.overview.loadError" />.** The panel didn't get an answer from the server. If the panel has been open for a long time, reload the page. If the server is down, read the container log, see [Logs and diagnostics](/docs/maintain/logs#the-container-log).

## Next

- [Downloads](/docs/panel/downloads).
- [Troubleshooting](/docs/troubleshooting): every problem from <Ui k="panel.overview.attention.title" /> in one place.
