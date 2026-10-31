---
title: Download and keep
description: "What happens to what you watch: the watch cache, Keep and Download, where files go and how the cache cleans itself up."
---

# Download and keep

Watching doesn't fill your disk. What you stream goes to the watch cache, which cleans itself up. What you want to keep goes to the library: download it in advance, or keep what you already started.

::: tip What you'll learn
What is downloaded while you watch, when to use <Ui k="download.keep" /> and when to download, and where the files end up.
:::

## While you watch

Torsher doesn't download the whole release when you start watching. It fetches about 3 minutes of video ahead of where you are, at least 64 MB and at most 1 GB, and keeps that window filled as you watch. Seek, and the window moves with you. Leave the player, and the download stops.

What you watched stays in the cache, in the downloads folder. Open the same release again and the downloaded parts play at once. Nothing from the cache goes to your library.

## The cache cleans itself up

The cache has a size limit, and the server keeps some disk space free. When the cache is over its limit, or free space drops below the reserve, Torsher deletes the releases that haven't been opened for the longest time.

- What you keep or download, and what someone is watching right now, is never deleted.
- Your watch position stays. If you open a deleted release again, it downloads again.

Both numbers are in the panel under <Ui k="panel.nav.settings panel.settings.nav.storage" />: <Ui k="panel.settings.storage.cacheTitle" /> and <Ui k="panel.settings.storage.reserveTitle" />. The same page lists what goes first. See [Storage](/docs/setup/storage).

## Keep what you started

Watched part of a movie or a few episodes and want them for good? Hold OK on the poster, or select <Ui k="actions.more" /> on the title page, and pick <Ui k="download.keep" />: <Ui k="download.keepHint" />.

- The releases of this title you watched leave the cache.
- Every video you started in them downloads to the end and goes to the library.
- From now on, any other video you start in these releases downloads in full.

The item then reads <Ui k="download.kept" />. It only appears once you have watched something of the title.

## Download a movie or a season

Download ahead of time, for a trip or for a weak connection:

1. On the title page, select <Ui k="download.movie" />. For a series, pick the season chip first: the button downloads that season, and its second line says how many episodes it has or how many are already in the library.
2. <Ui k="download.sourcesTitle" /> opens: the same [Sources](/docs/watch/sources) screen, already filtered to the season. Pick a release.
3. <Ui k="files.title" /> opens with the season's episodes, or the movie, already ticked. Change the selection if you want, and select <Ui k="files.downloadSelected" />. Episodes download in order, so you can start the first one while the rest are still downloading. To change the order, open the download in the [panel](/docs/panel/downloads).

To pick files yourself in any release, open it on <Ui k="files.title" /> and select <Ui k="files.select" />. OK now ticks a file instead of playing it. A season heading ticks the whole season. <Ui k="files.selectAll" />, <Ui k="files.clearAll" /> and <Ui k="files.cancel" /> are next to it, and Back leaves the selection. Files that are already downloading or in the library can't be ticked.

While it downloads, the button on the title page shows the progress, the release, peers and speed. OK on it offers:

- <Ui k="download.cancel" />: <Ui k="download.cancelHint" />.
- Another release, or the next season.

When everything is in the library, the button goes away. To get the same title in another release, select <Ui k="actions.more" /> on the title page and pick <Ui k="download.other" />, or another release of the season for a series.

## Where files go

| Folder in the panel | What's in it |
|---|---|
| <Ui k="panel.settings.storage.folders.downloads" /> | Releases as the torrent engine downloads them, including the cache |
| <Ui k="panel.settings.storage.folders.library" /> | What you kept or downloaded, sorted into folders by movie, series and season |

When a download finishes, Torsher matches its files to episodes and places them in the library. The title page shows <Ui k="download.placing" /> for a moment. If the files have no episode numbers, it shows <Ui k="download.unmatched" />: watch them from <Ui k="files.title" />.

A file in the library is a hard link to the downloaded one. It takes no extra space and the release keeps seeding. This needs both folders on one mounted volume; otherwise every file is copied. See [Kept files are copied instead of hard-linked](/docs/troubleshooting#copies).

## Check

- Posters show the state at the bottom right: the percentage while it downloads, a tick when it's downloaded, and a shelf when it's in the library.
- On <Ui k="files.title" />, each file shows <Ui k="download.state.downloaded" /> or <Ui k="download.state.library" />, or its progress.
- The title appears in <Ui k="nav.library" />. See [Library and home videos](/docs/watch/library).
- In the panel, <Ui k="panel.nav.torrents" /> lists every download. See [Downloads](/docs/panel/downloads).

## If something went wrong

- **The server is low on disk space.** See [Not enough free space](/docs/troubleshooting#low-space).
- **Not enough cache space.** See [The file doesn't fit in the cache](/docs/troubleshooting#cache-limit).
- **Waiting for peers.** The download continues by itself when peers appear. If it stays there, cancel it and pick a release with more seeders.
- **<Ui k="download.unmatched" />.** The release has no episode numbers in its file names. Watch from <Ui k="files.title" />, or set the episodes of its files in the panel. See [Downloads](/docs/panel/downloads).

## Next

[Library and home videos](/docs/watch/library): what you downloaded, and your own folders.
