---
title: Storage
description: "Where Torsher keeps what you watch and what you keep: the cache and its limit, the free space reserve, hard links between downloads and the library, changing and moving folders, and connecting your own folders read-only."
---

# Storage

Torsher keeps what you watch in a cache that cleans itself up, and what you keep in a library laid out by title. This page explains both, the two limits that control disk space, and how to change or move the folders.

::: tip What you'll get
A cache limit and a reserve that fit your disk, downloads and the library on one volume so kept files take no extra space, and your existing folders connected without copying.
:::

## Before you start

- Torsher is running and you can open the control panel. Everything on this page is in <Ui k="panel.nav.settings panel.settings.nav.storage" />. The <Ui k="panel.wizard.storage.title" /> step of the [setup wizard](/docs/setup/wizard) shows the same folders and limits.
- To use another disk, mount it into the container first. See [Docker Compose](/docs/install/docker-compose#several-disks).

## Cache and library

Torsher has two places for video files:

- **The cache**, in the downloads folder. Watching downloads the torrent here, and it stays after you stop watching, so you can come back to it. When the cache is full, the torrents you haven't opened for the longest time are deleted.
- **The library**, in the library folder. When you select <Ui k="download.keep" /> or <Ui k="download.movie" /> on the TV, the files are downloaded in full and placed in the library. Nothing deletes them on its own.

A kept torrent stays in the downloads folder and keeps seeding. The library gets the same file through a hard link, so it takes no extra space; see [How kept files reach the library](#how-kept-files-reach-the-library).

The library uses the folder names that Jellyfin, Plex and Kodi read, with the TMDB ID in the folder name:

```text
movies/Title (2010) [tmdbid-12345]/Title (2010) [tmdbid-12345].mkv
shows/Title (2008) [tmdbid-67890]/Season 01/Title S01E05.mkv
other/<release name>/…
```

Subtitles and extra audio tracks lie next to the video with the same base name. A second version of the same movie gets the quality in its name, for example `… - 2160p.mkv`. Releases that are neither a movie nor a series go to `other/`.

At the top of the page, a bar shows the downloads volume: <Ui k="panel.torrents.zones.keep" />, <Ui k="panel.torrents.zones.cache" />, library files not shared with torrents, other files on the disk, and free space. The <Ui k="panel.settings.storage.library.title" /> card below it shows how much the library takes and how files get there.

## Set the cache limit

The <Ui k="panel.settings.storage.cacheTitle" /> card sets how much space the cache may take, in gigabytes, at least 1.

Until you save your own value, the limit is half of the downloads volume, but no more than 200 GB. The card says <Ui k="panel.settings.storage.defaults" />

When the cache goes over the limit, the server deletes cache torrents in order: the one opened longest ago first, or the one added longest ago if it was never opened. It never deletes:

- kept torrents and what's in the library;
- what is playing now or was played in the last 10 minutes.

The <Ui k="panel.settings.storage.queue.title" /> card shows the next torrents in line. <Ui k="panel.settings.storage.queue.open" /> opens <Ui k="panel.nav.torrents" /> filtered to the cache.

Before playback starts, the server frees cache space for the rest of the file. If the file doesn't fit even then, the player says so; see [The file doesn't fit in the cache](/docs/troubleshooting#cache-limit).

A new limit applies right away: if it's lower than what the cache takes, the extra is deleted immediately.

## Set the free space reserve

The <Ui k="panel.settings.storage.reserveTitle" /> card sets how much space must stay free on the disk. Until you save your own value, it's 10% of the downloads volume, but no more than 20 GB. Keep at least 20 GB if the disk allows.

When free space drops below the reserve:

1. The server deletes cache torrents in the same order as for the cache limit.
2. If there is nothing left to delete, new playback doesn't start, and the showcase explains why.
3. Downloads pause.

Downloads resume on their own once free space is back above the reserve with a 1 GB margin. Torrents you paused yourself stay paused. The server checks space every minute and before every playback.

The cache limit is one for all folders. The reserve is kept on each volume separately: deleting cache on one disk doesn't free space on another.

## How kept files reach the library

The server places a kept file in the library in the first way that works:

| Method | When | Space |
| --- | --- | --- |
| Hard link | Downloads and the library are on the same mounted volume | No extra space. The torrent keeps seeding from the same file |
| Reflink | No hard links, but the file system can share blocks, such as btrfs or XFS | No extra space |
| Copy | Downloads and the library are on different volumes | The file takes space twice until the torrent leaves the cache |

The server tests this with a small file when it starts and when you change a folder. The result is in the <Ui k="panel.settings.storage.library.title" /> card under <Ui k="panel.settings.storage.library.links" />, in the setup wizard and in the folder dialog.

After a copy, the kept torrent goes back to the cache: it seeds until the cache needs the space, and the library keeps its own copy. A copy appears in the library under its name only when it's complete, so a media server reading the folder never sees half a file.

::: warning Two volumes mean copies
Two mounted volumes block hard links even when they are on the same physical disk. Mount one folder for both and choose its subfolders, for example `/data/torrents` and `/data/library`, or `/storage/torrents` and `/storage/library` with a [second disk](/docs/install/docker-compose#several-disks).
:::

## Change the downloads or library folder

The <Ui k="panel.settings.storage.folders.title" /> card shows both folders with their free space and what they hold. A folder marked <Ui k="panel.settings.storage.folders.default" /> comes from the container: `DOWNLOADS_PATH` and `LIBRARY_PATH`, which are `/data/torrents` and `/data/library` in the image.

1. Mount the new disk in `docker-compose.yml` and apply the change. The container sees only mounted folders.

   ```bash
   docker compose up -d
   ```

2. In the row of the folder, select <Ui k="panel.settings.storage.folders.change" />.
3. Enter the path inside the container, or pick it in the folder list. The dialog checks the folder as you type: whether it's writable or will be created, its free space, and whether hard links work between downloads and the library.
4. If the current folder holds data, choose what to do with it:
   - <Ui k="panel.settings.storage.pathDialog.newOnlyTitle" />: new files go to the new folder, existing ones stay where they are and keep working.
   - Move: everything moves to the new folder in the background. The option shows how much will move, and it's unavailable if the new volume doesn't have the space.
5. Select <Ui k="panel.settings.storage.pathDialog.save" /> or <Ui k="panel.settings.storage.pathDialog.startMove" />.

The dialog doesn't accept a folder that:

- doesn't start with `/`;
- is inside the server's data folder `/data/db`;
- overlaps the other folder: downloads and the library must be separate;
- is one of your connected library folders, which are read-only.

<Ui k="panel.settings.storage.pathDialog.reset" /> in the dialog brings back the folder from the container, and the folder follows `DOWNLOADS_PATH` or `LIBRARY_PATH` again.

### How a move works

Progress is in the <Ui k="panel.settings.storage.folders.title" /> card. Downloads move one torrent at a time, and each one pauses only while it moves; a torrent that is playing moves after playback ends. The library moves one file at a time with its subtitles. Old files are deleted only after the new ones are checked. Within one volume, files move as hard links: fast, and without extra space.

<Ui k="panel.settings.storage.folders.cancel" /> stops after the current item: what has moved already works from the new folder. If the server restarts, the move continues where it stopped.

Anything left in the old folder shows up under the folder row with its size and a <Ui k="panel.settings.storage.folders.moveHere" /> button, or <Ui k="panel.settings.storage.folders.retry" /> after an error.

::: info Moving downloads away from the library
If downloads move to a volume without the library, library files are no longer shared with torrents. Kept torrents then go back to the cache and are deleted when it fills up; the library keeps its files. The dialog warns before you start.
:::

## Connect folders you already have

Movies and series you already have don't need to be copied. Mount the folder read-only and add it as a library:

1. In `docker-compose.yml`, under `volumes:` of the `torsher` service:

   ```yaml
   - /mnt/media/movies:/media/movies:ro
   ```

2. Apply the change:

   ```bash
   docker compose up -d
   ```

3. In <Ui k="panel.nav.library" />, select <Ui k="panel.library.add.title" /> and enter the path inside the container, `/media/movies`.

Torsher indexes the folder in place and never writes to it. If the disk is disconnected, the folder shows <Ui k="panel.library.status.offline" />, its files are hidden on the showcase but not deleted, and they come back with the disk. Scans, matching and hiding a library from profiles: [Library](/docs/panel/library).

## Check

- The <Ui k="panel.settings.storage.library.title" /> card says hard link or reflink under <Ui k="panel.settings.storage.library.links" />.
- Free space on the bar is above the reserve.
- <Ui k="panel.overview.attention.title" /> on <Ui k="panel.nav.overview" /> has no storage items.

## If something went wrong

- **Free space is below the reserve, or downloads are paused.** See [Not enough free space](/docs/troubleshooting#low-space).
- **The file doesn't fit in the cache.** See [Troubleshooting](/docs/troubleshooting#cache-limit).
- **Kept files are copied.** See [Troubleshooting](/docs/troubleshooting#copies).
- **A folder is not writable.** `PUID` and `PGID` don't match the owner of the folder on the host. See [Troubleshooting](/docs/troubleshooting#not-writable).
- **A move stopped.** The card says why. Out of space: free some up and select <Ui k="panel.settings.storage.folders.retry" />. Can't write: fix `PUID`, `PGID` or the folder permissions. A file with the same name already exists in the new folder: remove or rename it, then retry. What has moved keeps working either way.
- **A connected folder is unavailable.** See [Troubleshooting](/docs/troubleshooting#library-offline).

## Next

- [Download and keep](/docs/watch/download-keep).
- [Library](/docs/panel/library).
- [Backup and move](/docs/maintain/backup).
