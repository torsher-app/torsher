---
title: Downloads
description: "Every torrent on the server: states and filters, adding a magnet link or a .torrent file, choosing files, keeping, setting the title, deleting, and what to do when a download is stuck."
---

# Downloads

<Ui k="panel.nav.torrents" /> lists every torrent on the server: what you watch on the TV, what you chose to download, and what you added here by hand. Here you see the progress, keep a torrent or let the cache remove it, fix its title and delete it.

::: tip What you'll learn
What each state means, how to add a torrent from the panel, the difference between the cache and a kept torrent, and what to do when a download doesn't move.
:::

## The cache and kept torrents

Every torrent is either in the cache or kept:

- **In the cache.** Something you only watched. Only the parts you watch are downloaded. When the cache is full or space runs out, the torrent opened longest ago is removed first. The order is in <Ui k="panel.nav.settings panel.settings.nav.storage" />, card <Ui k="panel.settings.storage.queue.title" />.
- **Kept.** Started files download in full and the torrent is never removed automatically. Finished files go to the library, so the showcase shows them as yours.

The TV does the same with its download and keep actions, see [Download and keep](/docs/watch/download-keep).

## The list

Torrents are grouped by state: <Ui k="panel.torrents.groups.attention" />, <Ui k="panel.torrents.groups.active" />, <Ui k="panel.torrents.groups.paused" />, <Ui k="panel.torrents.groups.seeding" />, <Ui k="panel.torrents.groups.complete" /> and <Ui k="panel.torrents.groups.idle" />. Each row shows the title, size and number of files, the state, and the progress.

| State | What it means |
| --- | --- |
| <Ui k="panel.torrents.states.watching" /> | Someone is playing it right now. |
| <Ui k="panel.torrents.states.queued" /> | Waits for the downloads ahead of it. You can already watch it. |
| <Ui k="panel.torrents.states.downloading" /> | Downloading. |
| <Ui k="panel.torrents.states.stalled" /> | Nobody is seeding it right now. It continues as soon as peers appear. |
| <Ui k="panel.torrents.states.paused" /> | You paused it. |
| <Ui k="panel.torrents.states.pausedStorage" /> | Free space is below the reserve: the download waits for space. |
| <Ui k="panel.torrents.states.seeding" /> | Downloaded and uploading to other peers. |
| <Ui k="panel.torrents.states.complete" /> | Downloaded and not seeding. |
| <Ui k="panel.torrents.states.partial" /> | Only the watched parts are on disk. |
| <Ui k="panel.torrents.states.idle" /> | Nothing is downloading. |
| <Ui k="panel.torrents.states.resolving" /> | A magnet link waits for the file list from peers. |
| <Ui k="panel.torrents.states.failed" /> | Peers didn't send the file list. |

Above the list:

- **Filters.** <Ui k="panel.torrents.filters.all" />, <Ui k="panel.torrents.filters.active" />, <Ui k="panel.torrents.filters.paused" />, <Ui k="panel.torrents.filters.seeding" />, and <Ui k="panel.torrents.filters.cache" /> for torrents in the cache that have something on disk. Each shows how many torrents it has.
- **Search** by torrent name.
- **Totals.** On a wide screen, the total speed and how much of the cache limit is used. Click them to open <Ui k="panel.settings.nav.storage" />.

## Add a torrent

1. Select <Ui k="panel.torrents.add" />.
2. Choose <Ui k="panel.torrents.addDialog.magnetTitle" /> and paste it, or <Ui k="panel.torrents.addDialog.fileTitle" /> and pick a file up to 8 MB.
3. Select <Ui k="panel.torrents.addDialog.submit" />.

What happens next depends on the torrent:

- **One video, such as a movie.** It starts downloading in full right away.
- **Several videos, such as a season.** Its card opens with the videos checked. Uncheck what you don't need and select <Ui k="panel.torrents.download" />.
- **A magnet link.** The file list comes from peers, usually within seconds. The card opens and fills in when the list arrives.
- **A torrent that is already in the list.** Its card opens.

Downloading files also keeps the torrent. To only watch a torrent with several videos, close its card instead: its videos open in the showcase and download only while you watch. For a first check, free films such as Big Buck Bunny or Sintel work well.

## A torrent's card

Click a row to open its card on the right.

- **Status, size, speed, peers and seeding.** How much has been uploaded, the ratio, and why seeding stopped, if it did.
- **<Ui k="panel.torrents.card.title" />.** The movie or series the torrent belongs to. See [Set the title](#set-the-title).
- **<Ui k="panel.torrents.card.wanted" />.** How many files download in full, or <Ui k="panel.torrents.card.wantedNone" />.
- **<Ui k="panel.torrents.card.storage" />.** Whether the torrent is in the cache, kept, or already in the library.
- **<Ui k="panel.torrents.card.added" />** and **<Ui k="panel.torrents.card.watched" />.**
- **<Ui k="panel.torrents.card.files" />.** Check files and select <Ui k="panel.torrents.download" />: checked files download in full and the torrent becomes kept, the rest download only while watched. The play button next to a video opens it in the showcase.
- **Download order.** Episodes download one after another, so the first episode is ready to watch long before the season finishes. To get another file sooner, select the up arrows next to it: raised files download before the rest, then the order picks up again. The file that is downloading now is marked <Ui k="panel.torrents.downloadingFirst" />.

Buttons at the bottom:

- **<Ui k="panel.torrents.download" />.**
- **<Ui k="panel.torrents.keep" />** moves the torrent out of the cache. **<Ui k="panel.torrents.unkeep" />** stops the full download and returns it to the cache: what is downloaded stays until the cache fills up.
- **<Ui k="panel.torrents.removeLibrary" />,** when files are already in the library.
- **<Ui k="panel.common.delete" />.**

### Seeding rule for one torrent

A kept torrent has <Ui k="panel.torrents.card.seedRule" /> in its card. By default it follows the rule in <Ui k="panel.nav.settings panel.settings.nav.torrent" />. Choose another one for this torrent only: <Ui k="panel.settings.torrent.seedRule.modes.always" />, <Ui k="panel.settings.torrent.seedRule.modes.ratio" />, <Ui k="panel.settings.torrent.seedRule.modes.time" /> or <Ui k="panel.settings.torrent.seedRule.modes.never" />, and select <Ui k="panel.common.save" />. While a torrent downloads or someone watches it, it always seeds.

### Set the title

Torsher recognizes the movie or series by the torrent name. If it isn't sure, the card says which title it looks like:

- <Ui k="panel.torrents.match.confirm" /> accepts the suggestion.
- <Ui k="panel.torrents.match.fix" /> (or <Ui k="panel.torrents.match.change" />) opens a catalog search. Pick the title and select <Ui k="panel.common.save" />, or select <Ui k="panel.torrents.match.notTitle" /> for anything else.

A torrent without a title still plays, but its files don't go to the library.

## Pause, resume and other actions

The pause button and the actions menu sit at the end of each row:

- <Ui k="panel.torrents.pause" /> and <Ui k="panel.torrents.resume" />.
- <Ui k="panel.torrents.keep" /> or <Ui k="panel.torrents.unkeep" />.
- <Ui k="panel.torrents.retry" />, for a magnet link that didn't get its file list.
- <Ui k="panel.common.delete" />.

## Delete a torrent

Select <Ui k="panel.common.delete" /> and choose:

- <Ui k="panel.torrents.deleteDialog.withFiles" />: frees the space on disk.
- <Ui k="panel.torrents.deleteDialog.keepFiles" />: the files stay on disk, but Torsher stops counting them and never deletes them automatically.

Either way, the engine stops downloading and seeding it. Files already in the library stay there. To free that space, remove them from the library first.

### Remove from the library

<Ui k="panel.torrents.removeLibrary" /> removes the torrent's files from the library. The torrent goes back to the cache and is removed when the cache fills up.

::: warning When the torrent is no longer on disk
If the torrent's own files are already gone, the library files are the only copy, and removing them deletes them for good. The dialog says so.
:::

## Restart the engine

<Ui k="panel.torrents.restartEngine" /> in the top bar restarts the torrent engine when it seems stuck. Playback pauses for a few seconds and then picks up on its own. The button is unavailable while the engine is starting or not running.

## If something went wrong

- **<Ui k="panel.torrents.states.stalled" />.** Nobody is seeding the torrent. Choose another release with more seeders, see [Playback waits for peers](/docs/troubleshooting#waiting-for-peers).
- **<Ui k="panel.torrents.states.failed" />.** Check the magnet link and select <Ui k="panel.torrents.retry" />, or add the `.torrent` file instead. See [The torrent has no file list](/docs/troubleshooting#no-file-list).
- **<Ui k="panel.torrents.states.pausedStorage" />.** Everything in the cache is being watched or kept, so nothing can be freed. Delete what you don't need or lower the reserve, see [Not enough free space](/docs/troubleshooting#low-space). The download resumes by itself.
- **A banner says the engine isn't running.** Torrents can't be added or watched. See [The torrent engine isn't running](/docs/troubleshooting#engine).
- **<Ui k="panel.torrents.errorTitles.invalid" />.** The link or the file isn't a valid torrent. A magnet link starts with `magnet:?xt=urn:btih:`.

## Next

- [Following](/docs/panel/follow), for series that download by themselves.
- [Settings](/docs/panel/settings#torrent), for speed limits, the queue and seeding.
