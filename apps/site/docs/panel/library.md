---
title: Library
description: "Libraries on the server: the Torsher layout, connecting folders you already have, scans, unrecognized releases, home videos and hiding a library from profiles."
---

# Library

<Ui k="panel.nav.library" /> shows where the showcase finds files that are already on disk: the Torsher layout, filled by downloads you keep, and folders with movies, series or home videos that you connect. Connected folders are indexed in place and only read: nothing is moved or renamed.

::: tip What you'll learn
How to connect a folder you already have, how scans work, and how to fix releases that Torsher didn't recognize.
:::

## Before you start

- The folder must be visible inside the container: mount it in `docker-compose.yml` first, read-only (`:ro`) if you can. See [Storage](/docs/setup/storage).

## The Torsher layout

<Ui k="panel.library.managed" /> is always first. Downloads and kept torrents put their files here, so they show up on the showcase as yours. It can't be removed or edited here: its folder is set in <Ui k="panel.nav.settings panel.settings.nav.storage" />.

## Add a library

1. Select <Ui k="panel.library.add.title" />.
2. Choose <Ui k="panel.library.add.kind" />:
   - <Ui k="panel.library.kinds.video" />: matched with the catalog, with posters, overviews and episodes.
   - <Ui k="panel.library.kinds.home" />: no catalog. Videos are sorted by capture date, and folders become albums.
3. Enter a <Ui k="panel.library.add.name" /> and the <Ui k="panel.library.add.path" />: the path inside the container, for example `/media/video`.
4. For movies and shows, pick a <Ui k="panel.library.add.hint" />: <Ui k="panel.library.hints.auto" />, <Ui k="panel.library.hints.movies" /> or <Ui k="panel.library.hints.shows" />. It only narrows the catalog search: the server still decides per release.
5. Select <Ui k="panel.library.add.submit" />.

The scan runs in the background, and files appear on the showcase as they are indexed. To add another folder to the same library, select <Ui k="panel.library.addFolder.title" /> under its folders.

## Folders and scans

Each folder shows its path, its status and how many videos it has:

| Status | What it means |
| --- | --- |
| <Ui k="panel.library.status.ok" /> | Indexed. |
| <Ui k="panel.library.status.scanning" /> | A scan is running. |
| <Ui k="panel.library.status.empty" /> | No videos found. |
| <Ui k="panel.library.status.offline" /> | The folder is gone or the disk is disconnected. Its files are hidden on the showcase, not deleted, and come back with the folder. |
| <Ui k="panel.library.status.denied" /> | The server can't read the folder. Its files are hidden, not deleted. |

Below the status, the folder lists when it was last scanned and, if any, files being recognized, missing files, files waiting for confirmation and files not recognized.

New files show up within a minute: the server watches the folders for changes. On a network volume, or when the watcher doesn't start, the folder says so and the scan every 12 hours picks up changes instead. The scan button next to a folder starts a scan right away. <Ui k="panel.library.folder.remove" /> takes the folder out of the library, and the files on disk stay.

## Releases that weren't recognized

When some files can't be matched to a title, the <Ui k="panel.library.unmatched.title" /> card appears at the top. Until you fix them, they are under “No description” on the showcase.

- <Ui k="panel.torrents.match.confirm" /> accepts the title Torsher suggests.
- <Ui k="panel.torrents.match.fix" /> opens a catalog search. Pick the title and select <Ui k="panel.common.save" />. For a series, <Ui k="panel.library.episodes.next" /> shows how the files map to seasons and episodes: fix a number if needed. An empty episode means the file isn't an episode and stays under “No description”.
- <Ui k="panel.torrents.match.notTitle" /> leaves the files under “No description”.

## Library settings

The menu of a connected library has:

- **<Ui k="panel.library.addFolder.title" />.**
- **<Ui k="panel.library.files.title" />,** for home videos: each video's date and where it came from. Select <Ui k="panel.library.files.edit" /> to set a date by hand.
- **<Ui k="panel.library.settings.title" />:**
  - <Ui k="panel.library.add.name" />.
  - <Ui k="panel.library.settings.exclude" />: path masks from the folder root, one per line, such as `Trash/**` or `**/*.sample.*`.
  - <Ui k="panel.library.settings.watch" />: turn it off to rely on the periodic scan only.
  - <Ui k="panel.library.settings.visible" />: uncheck a profile to hide the library from it.
- **<Ui k="panel.library.remove.action" />.** The library leaves Torsher together with the progress of its home videos. Files on disk stay.

## If something went wrong

- **<Ui k="panel.library.pathErrors.title" />.** Use the full path inside the container. If the server says there is no such folder, it isn't mounted in `docker-compose.yml`. Downloads and the Torsher layout can't be connected as a library.
- **<Ui k="panel.library.status.offline" />.** See [A library folder is unavailable](/docs/troubleshooting#library-offline).
- **Files are under “No description”.** See [Releases are not recognized](/docs/troubleshooting#unmatched).

## Next

- [Library and home videos](/docs/watch/library): what the showcase shows.
- [Collections](/docs/panel/collections).
