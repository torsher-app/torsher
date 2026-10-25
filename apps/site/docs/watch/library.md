---
title: Library and home videos
description: "Your own library on the TV: what you downloaded and your connected folders, files without a description, releases that need a title, and home videos."
---

# Library and home videos

The library is what's on the server disk: movies and series you downloaded or kept, folders you connected in the panel, and home videos. It plays without peers and without waiting.

::: tip What you'll learn
Where library files show up on the TV, how to fix a release Torsher didn't recognize, and how to browse home videos by date and by album.
:::

## What's in the library

- **Downloads you kept.** <Ui k="download.keep" /> and downloads go to the library when they finish. See [Download and keep](/docs/watch/download-keep).
- **Connected folders.** Your existing collection on the server. The owner connects a folder in the panel, and Torsher indexes it in place, read-only: nothing is moved or renamed. Movies and series are matched with the catalog and get posters, descriptions and episodes. See [Library](/docs/panel/library).
- **Home videos.** A connected folder of the home video kind. It isn't matched with the catalog: videos are sorted by capture date and grouped into albums by folder.

The owner can hide a connected library from some profiles in its settings, under <Ui k="panel.library.settings.visible" />.

## The Library section

<Ui k="nav.library" /> in the side menu shows only your own files, in rows:

- <Ui k="home.rows.continue" />: what you started from the library;
- <Ui k="home.rows.libraryUnmatched" />: downloads that need a title (see below);
- <Ui k="home.rows.libraryRecent" />: titles added in the last 30 days;
- <Ui k="home.rows.libraryMovies" /> and <Ui k="home.rows.librarySeries" />;
- <Ui k="home.rows.libraryHomeVideo" />;
- <Ui k="home.rows.libraryUntitled" />: files Torsher couldn't match.

Empty rows are hidden. On <Ui k="nav.home" />, the <Ui k="home.rows.library" /> row shows the latest titles.

## Watch from the library

Library titles open the usual title page. When the episode you're up to is in the library, <Ui k="title.watch" /> plays it from the disk at once, and its second line says <Ui k="title.fromLibraryShort" />. The <Ui k="title.sources" /> icon next to it still lets you stream another release.

Episodes in the library have a shelf icon on their still. On the <Ui k="sources.title" /> screen, the library file comes first, marked <Ui k="sources.libraryHint" />.

The player works as usual, with the next episode taken from the library when it's there. See [Player](/docs/watch/player).

## No description

<Ui k="home.rows.libraryUntitled" /> holds video files from connected folders that Torsher didn't find in the catalog. OK plays a file right away, and your position is kept.

To give them a title, open <Ui k="panel.nav.library" /> in the panel: they are listed under <Ui k="panel.library.unmatched.title" />. Once you pick the title, the files move to the movie or series. See [Releases are not recognized](/docs/troubleshooting#unmatched).

## Needs a title

<Ui k="home.rows.libraryUnmatched" /> holds downloads that Torsher couldn't match to a title, so they can't go to the library yet. Each card shows the release name, what it has, and either a guess or <Ui k="release.unmatched" />.

Press OK on a card and pick:

- **The suggested title**, if the guess is right.
- **<Ui k="release.search" />**: the search screen opens with the release name. Fix the query and press OK on the right poster.
- **<Ui k="release.ignore" />**: <Ui k="release.ignoreHint" />.

After you pick a title, the files go to the library. This row is shown only to profiles without an age limit.

## Home videos

The first tile of the <Ui k="home.rows.libraryHomeVideo" /> row, <Ui k="homeVideo.all" />, opens every video in one place:

- **<Ui k="homeVideo.dates" />**: a grid under month headings, newest first. The date comes from the file's metadata, its name or the file time.
- **<Ui k="homeVideo.albums" />**: one card per folder, with the number of videos and the dates. OK opens the album.

A wrong date can be fixed in the panel: open the home video library and its <Ui k="panel.library.files.title" />.

## If something went wrong

- **<Ui k="state.libraryEmpty.title" />.** Nothing is downloaded, kept or connected yet, or the libraries are hidden from your profile.
- **Files from a connected folder disappeared.** The folder or the disk is unavailable. The files come back with it. See [A library folder is unavailable](/docs/troubleshooting#library-offline).
- **<Ui k="release.restricted" />.** Switch to a profile without an age limit, or pick the title in the panel.

## Next

[Mine](/docs/watch/mine): your lists, ratings and collections.
