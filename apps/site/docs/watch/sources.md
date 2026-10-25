---
title: Sources and voice-overs
description: "Choose a release: the Sources and Files screens, quality and voice-over badges, filters, your own search query and season packs."
---

# Sources and voice-overs

Torsher doesn't pick a release behind your back. <Ui k="title.watch" /> opens the <Ui k="sources.title" /> screen with every release your indexers found, and you choose one. Then the <Ui k="files.title" /> screen shows what's inside, and OK on a file starts the player.

::: tip What you'll learn
How to read a release row, narrow the list down to your voice-over and quality, search by your own title, and pick episodes from a season pack.
:::

## Before you start

At least one indexer is connected. See [Indexers](/docs/setup/indexers).

## Open Sources

- On a title page, select <Ui k="title.watch" />. When it reads <Ui k="title.resume" /> and plays right away, use the <Ui k="title.sources" /> icon next to it.
- In the player, select <Ui k="player.source.button" /> to switch releases without stopping. See [Player](/docs/watch/player#switch-the-release).

Torsher searches all your indexers by every name of the title: the translated one, the original and other names from TMDB. It keeps only releases that match the title. The header shows how many releases were found and when, and how many indexers didn't answer. <Ui k="sources.refresh" /> at the end of the list searches again.

Under the header is your history: what you watched last and from which release. OK on it opens that release on the same episode.

## Read a release row

Each row has three lines:

1. **The release name**, as the indexer has it.
2. **Badges.** First the resolution: 4K, 1080p, 720p or SD. A question mark means it was guessed from other hints in the name, and a lone `?` means unknown. Then what the release covers, such as `S1 · 1–8` or `S1–3`, the source (Remux, Blu-ray, Web, TV, DVD; <Ui k="sources.sourceKinds.cam" /> is a recording from a cinema screen), HDR, the codec and the audio channels. Then the voice-over: the studio or language and its type, such as <Ui k="sources.voiceTypes.D" />, <Ui k="sources.voiceTypes.MVO" /> or <Ui k="sources.voiceTypes.Original" />, and other audio tracks after it. <Ui k="sources.unsure" /> warns that the name only partly matches the title.
3. **Details.** A mark on the left, then the publish date, subtitles and the indexer. On the right, the bitrate, seeders (green from 10, amber below, red at 0), leechers and the size of the whole release.

For example, a row could read:

```
Example.Show.S01.1080p.WEB-DL.H264.MVO
1080p   S1 · 1–8   Web   5.1   Example Studio · Multi-voice
By profile · Oct 12, 2026 · subtitles: ENG · My indexer      6 Mbps  ↑ 42  ↓ 3  14.2 GB
```

## Which release comes first

- The release you watched last is always first, marked <Ui k="sources.lastWatched" />.
- The best one for the profile comes next, marked <Ui k="sources.byProfile" />. The profile is shown in the header: quality 1080p, then 4K, then 720p, and the voice-over types from dubbing down. The profile is the same for the whole server and isn't adjustable.
- The rest follow the sort order. A series sorts <Ui k="sources.sortSeasons" /> by default: the newest season and more episodes first.

## Filters and sorting

Chips above the list narrow it down. OK on a chip opens a panel of choices:

- **<Ui k="sources.panel.sort" />**: <Ui k="sources.sortBest" />, <Ui k="sources.sortSeeders" />, <Ui k="sources.sortSize" />, <Ui k="sources.sortDate" />, and <Ui k="sources.sortSeasons" /> for a series.
- **<Ui k="sources.panel.season" />**: releases with this season, when a series has more than one.
- **<Ui k="sources.panel.voice" />**: one voice-over studio or type.
- **<Ui k="sources.panel.quality" />**: 4K, 1080p, 720p, SD or <Ui k="sources.unknownQualityOption" />.

The round chip with a cross resets the filters. This TV remembers the sort and filters for each title.

## Refine the search

If the indexers name the title differently, for example by a short name or a spelling of their own, search by your own query:

1. Select the <Ui k="sources.panel.query" /> chip, the first one. It shows the current query or `auto`. On an empty result, <Ui k="sources.query.action" /> opens the same panel.
2. Type a title in <Ui k="sources.query.placeholder" /> and press OK, or pick one of the suggested names below.

The query is remembered for this title. <Ui k="sources.query.auto" /> goes back to searching by the names from TMDB.

## Pick a file

OK on a release connects to it and opens <Ui k="files.title" />. A new release first needs its file list from peers, which takes from a few seconds to a minute.

- Each episode shows its still, number and name, season, air date, runtime and how much is left, or <Ui k="files.watched" />. The file name is below.
- The focus lands on the episode to watch next: the one you left off, or the one after the last you finished.
- A release with one video skips this screen and starts the player. Back from the player then returns to <Ui k="sources.title" />.

If an episode is already in your library, <Ui k="sources.title" /> shows it first with <Ui k="sources.libraryHint" />. It plays from the server disk.

## Season packs

A release that covers several seasons shows them in its badge, for example `S1–3`. On <Ui k="files.title" />, its episodes are grouped under season headings, and the season you set in the <Ui k="sources.panel.season" /> filter is where the focus lands.

You don't need to come back here for every episode. The player moves to the next episode of the same release, and finds it in another release with the same voice-over when this one doesn't have it. See [Player](/docs/watch/player#next-episode).

To download a whole season from a pack, see [Download and keep](/docs/watch/download-keep#download-a-movie-or-a-season).

## If something went wrong

- **<Ui k="sources.empty.noIndexers.title" />.** Connect an indexer. See [Indexers](/docs/setup/indexers).
- **<Ui k="sources.empty.failed.title" />.** See [An indexer doesn't respond or rejects requests](/docs/troubleshooting#indexer-error).
- **<Ui k="sources.empty.nothing.title" />.** Refine the search as above. See also [Search finds nothing](/docs/troubleshooting#nothing-found).
- **<Ui k="sources.empty.filtered.title" />.** Reset the filters or pick other values.
- **<Ui k="files.timeout" />** The release has too few peers. Pick another one with more seeders. See [The torrent isn't ready or has no file list](/docs/troubleshooting#no-file-list).

## Next

[Player](/docs/watch/player): audio, subtitles and the next episode.
