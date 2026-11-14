---
title: Showcase and remote
description: "Find your way around the showcase: the side menu, home rows, search, the catalog, the title page, the remote, the pointer and long press for actions."
---

# Showcase and remote

The showcase is the Torsher app on your TV, or in a browser. This page covers its sections, the title page and how to get around with a remote, a Magic Remote pointer, a mouse or a keyboard.

::: tip What you'll learn
Where each section is, what every remote key does, and how to open the actions menu on any poster.
:::

## Before you start

The device is connected to your server. See [Connect a device](/docs/tv/connect).

## The side menu

The menu on the left is always there, folded to icons. Press left from the content to open it, then up and down to pick a section:

- **<Ui k="nav.search" />**: titles and people by name.
- **<Ui k="nav.home" />**: your rows first, then what's popular in the catalog.
- **<Ui k="nav.movies" />** and **<Ui k="nav.series" />**: the same home screen for one type.
- **<Ui k="nav.catalog" />**: every title with filters. See [Catalog](#catalog).
- **<Ui k="nav.mine" />**: your lists and ratings. See [Mine](/docs/watch/mine).
- **<Ui k="nav.library" />**: files on the server. See [Library and home videos](/docs/watch/library).

Near the bottom are your avatar and name (OK switches the profile, see [Profiles and PIN](/docs/watch/profiles)), <Ui k="nav.settings" /> and <Ui k="common.about" />.

<Ui k="nav.settings" /> holds settings of this device, the same for every profile. Today it's <Ui k="settings.screensaver" />: movie stills and a clock when the TV is idle, so OLED screens don't burn in. Pick <Ui k="settings.screensaverOff" /> or 2 to 30 minutes, 5 by default. Any key wakes the TV without doing anything else.

## Home

The top of the screen shows the focused title: its backdrop, ratings, year, genres and description, with a hint of what OK does. <Ui k="nav.home" />, <Ui k="nav.movies" />, <Ui k="nav.series" /> and <Ui k="nav.library" /> share a compact layout, leaving room for the rows below. In <Ui k="home.rows.continue" />, it shows the remaining time when known, or the next episode, and the episode title when available instead of the plot. Your own rows on home come first, in this order, and only when they have something:

- <Ui k="home.rows.continue" />: what you watched in the last 16 weeks, and new episodes of series you follow. OK resumes right away. Older titles you haven't finished stay in [Mine](/docs/watch/mine).
- <Ui k="home.rows.newEpisodes" />: fresh episodes of series you watch.
- <Ui k="home.rows.watchlist" />: titles you saved for later.
- <Ui k="home.rows.libraryRecentlyAdded" />: titles with files added in the last 30 days, newest first.
- Collections shown on home.

A row holds up to 20 titles. When <Ui k="home.rows.continue" />, <Ui k="home.rows.watchlist" /> or a collection has more, the last card is <Ui k="home.all" /> with the total: OK opens the whole list in [Mine](/docs/watch/mine).

Then come catalog rows such as <Ui k="home.rows.trending" />, <Ui k="home.rows.popularMovies" /> and <Ui k="home.rows.onTheAir" />. They come from TMDB through your server; see [TMDB key](/docs/setup/tmdb) if they are empty.

Posters carry small badges: your rating at the top right, ratings of services at the bottom left (each profile picks them in the panel), a mark for watched titles, a bell for [followed](/docs/watch/follow) titles and the download state at the bottom right.

## Search

Type a title or an actor in the field. Torsher searches translated and original titles and people. Results appear as you type: posters with year and type, and up to four people above them. Without a query, the screen shows <Ui k="search.popular" />.

<Ui k="search.recent" /> keeps your last six searches on this device. A search is saved when you open a title from its results.

## Catalog

The catalog is a grid of every title that matches a set of filters. Chips at the top set <Ui k="catalog.panel.type" /> (movies, series, cartoons, cartoon series or anime), <Ui k="catalog.panel.genre" />, <Ui k="catalog.panel.year" />, rating, <Ui k="catalog.panel.language" />, <Ui k="catalog.panel.country" /> and <Ui k="catalog.panel.sort" />. A round chip with a cross resets them. The number of titles found is at the top.

Genre, studio and tag chips on a title page open the catalog with that filter.

## The title page

OK on a poster opens the title page. The first screen has the logo, ratings, year, runtime or number of seasons, the age rating and the description, followed by the action buttons and the start of the episodes or title facts. If the description doesn't fit, focus it and press OK to read it all.

The buttons:

- **<Ui k="title.watch" />** opens the [Sources](/docs/watch/sources) screen to pick a release. If you've started the title, the button reads **<Ui k="title.resume" />** and plays right away, with what's next in the second line. If the episode is in your library, it plays from the server disk.
- **<Ui k="download.movie" />**, or download the selected season: files go to your library. See [Download and keep](/docs/watch/download-keep).
- **<Ui k="follow.follow" />**: new episodes download on their own. See [Follow](/docs/watch/follow).
- Icon buttons: <Ui k="title.sources" /> (when <Ui k="title.watch" /> plays right away), <Ui k="actions.watchlist" />, <Ui k="actions.rate" /> and <Ui k="actions.more" />, which opens the actions menu.

Until the server has an indexer, the showcase works as a media library. Titles from your library play as usual. Other titles have no <Ui k="title.watch" />, download or <Ui k="follow.follow" /> buttons: you can add them to <Ui k="actions.watchlist" /> and rate them. See [Indexers](/docs/setup/indexers).

Press down for the rest of the page:

- **<Ui k="title.episodes" />** of a series: season chips and a row of episodes. The season of your next episode is selected when you open the title; choosing another season keeps your selection. The first tile, <Ui k="title.episodeList.open" />, opens the season as a list with descriptions. Both views offer the same [episode actions](#episode-actions).
- **<Ui k="title.aboutMovie" />** or **<Ui k="title.aboutSeries" />**: release dates, budget, countries, studios and other facts, plus chips of genres, studios and tags.
- **<Ui k="title.cast" />** and **<Ui k="title.crew" />**. OK opens a person with their photo, biography and films by role.
- **<Ui k="title.franchise" />** for a movie from a series of films, and **<Ui k="title.similar" />**.

### Episode actions {#episode-actions}

1. Focus an aired episode in the row or the full list and press OK. Its actions open on the right.
2. Press OK again on <Ui k="title.watch" /> or <Ui k="title.resume" /> to play that episode. If it has a saved position, <Ui k="player.fromStart" /> starts it at the beginning.
3. To change its watched mark, choose <Ui k="actions.markWatched" /> or <Ui k="actions.unmarkWatched" />. Holding OK for half a second does this directly. Releasing after the hold does not open the panel.

A file in your library plays first; if several versions are available, choose one. Otherwise Torsher searches your connected sources for this episode. Back from the version picker returns to its actions. Back from the actions returns to the same episode; in the full list, another Back closes the list.

The menu key or a right click also opens episode actions. Holding the left mouse button toggles the watched mark. Episodes that have not aired have no playback or watched actions. Replaying an episode does not clear its watched mark.

## The remote

| Key | What it does |
|---|---|
| Arrows | Move the focus. Left from the content opens the side menu |
| **OK** | Open or select what's in focus |
| Hold **OK** | Open the actions menu of a poster; toggle the watched mark of an episode |
| **Back** | Go one screen up |
| Page Up, Page Down | Scroll the grid in <Ui k="nav.mine" /> a screen at a time, on a keyboard or a remote that has them |
| Digits | Rate a title, enter a PIN |
| Play, Pause, rewind, forward, Stop | Work in the player |

**Back** goes up a level rather than retracing every step: from the player to the file list, then to <Ui k="sources.title" />, the title page and the screen you opened it from. Every section of the side menu goes back to <Ui k="nav.home" />. On <Ui k="nav.home" />, Back exits the app on a TV; newer LG TVs ask first. Deep in the grid of <Ui k="nav.mine" />, Back first jumps to the top of the grid.

### The actions menu

Hold OK on a poster for half a second, or select <Ui k="actions.more" /> on a title page. The menu has:

- <Ui k="actions.watchlist" />, <Ui k="actions.favorite" /> and <Ui k="actions.dropped" />, ticked when they are on;
- <Ui k="actions.rate" />: a rating from 1 to 10;
- <Ui k="actions.collections" />: the collections of your household;
- <Ui k="actions.markWatched" /> or <Ui k="actions.unmarkWatched" />;
- <Ui k="download.keep" />, after you have watched something from the title. See [Download and keep](/docs/watch/download-keep).

Back closes the menu and returns the focus where it was. The lists themselves are in [Mine](/docs/watch/mine).

## Magic Remote, mouse and keyboard

**Magic Remote.** Point to highlight, click to select. Pointing doesn't scroll rows or pages, so nothing moves under the cursor; the wheel scrolls rows. Press any arrow to go back to remote mode: the focus moves on from the item you pointed at. The cursor hides after a few seconds of rest.

Hold the click on a poster to open the actions menu. Whether a long press under the Magic Remote cursor works on every TV is not tested yet; the buttons on the title page do the same.

**Mouse.** In a browser, hover highlights, click selects, the wheel and the touchpad scroll pages and rows, and arrows at the edges of a row page through it. A right click on a poster opens the actions menu.

**Keyboard.** Arrows move, Enter is OK, Escape or Backspace is Back, and Space plays and pauses in the player. Digits rate titles and enter a PIN. The menu key opens the actions menu.

## Check the connection to this device {#connection-check}

Open <Ui k="nav.settings speedtest.title" /> from the side menu. One screen shows both the device connection and server internet results. Each block has its own <Ui k="speedtest.start" /> button. While a check is running, the other start button is disabled so the measurements do not compete. The device check measures **server → this device**, using the same address and reverse proxy as the showcase. It shows transfer speed, HTTP latency, duration, start time and the amount of test data. It does not measure the TV's internet connection or a torrent's peers.

The check measures for ten seconds after warmup, with a safety ceiling of 64 GiB of test payload and temporarily competes with viewing and downloads. The adaptive series needs three completed HTTP measurements of at least 10 ms each. Otherwise it shows <Ui k="speedtest.states.insufficient" /> instead of a speed. The result is the 90th percentile of valid speeds; the ten-second phase does not finish early when its samples become stable. The final aborted request adds to the traffic total, but not to that estimate. A dash is missing data, not zero.

Select <Ui k="speedtest.stop" /> to stop. The last shown measurements stay visible with a stopped status until the next <Ui k="speedtest.start" /> for that test. Press Back to stop and close the panel. Focus returns to the settings row. Opening it again does not start another check. Hiding the app or losing the session also stops it. Streaming APIs must be supported by the device; no native shell update is needed.

To check server internet, select <Ui k="speedtest.start" /> in the <Ui k="speedtest.internetTitle" /> block on the same screen. It shows <Ui k="speedtest.internetDirection" />: download and upload belong to the Torsher server, not to this TV. Each direction runs for ten seconds after warmup. The TV shows integer speed values, HTTP latency, phase, route, start time, duration and transferred payload, without graphs. Nothing starts until you select <Ui k="speedtest.start" />; <Ui k="speedtest.stop" /> or Back cancels your test, and Back returns focus to the row that opened it. Both result blocks remain on the same screen. Running one test does not clear the other result. Tests never start automatically after one another; Stop cancels the active test, while Back also closes the screen.

One check at a time is shared by all devices. A connected TV has a combined allowance of three successful local/server-internet starts per minute; invalid and busy requests do not use it. Revoking that TV in the panel stops its check. An older server that keeps server internet checks owner-only shows the optional check as unavailable without disconnecting the TV. See the panel's [network checks](/docs/setup/network#speed-check) for provider privacy, limits and the method. A result from the panel describes that browser, so run the showcase check on the TV itself when investigating its connection. Physical TV performance needs testing on the device; a desktop browser is not a substitute.

## If something went wrong

- **<Ui k="state.unauthorized.title" />.** The device lost its connection to the server. Select <Ui k="state.connect" /> and enter the new code. See [A device says it is not connected](/docs/troubleshooting#not-connected).
- **<Ui k="state.notConfigured.title" />.** The server has no TMDB key. See [No TMDB key](/docs/troubleshooting#tmdb-key-missing).
- **<Ui k="state.unavailable.title" />.** The server can't reach TMDB. See [The showcase says TMDB is unavailable](/docs/troubleshooting#tmdb-unavailable). Your own rows still show without it.
- **The TV doesn't show a code.** See [The TV doesn't show a code](/docs/troubleshooting#tv-no-code).

## Next

[Sources and audio](/docs/watch/sources): pick a release and start watching.
