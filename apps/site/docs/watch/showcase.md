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

The top of the screen shows the focused title: its backdrop, ratings, year, genres and description, with a hint of what OK does. Below are rows. Your own rows come first, and only when they have something:

- <Ui k="home.rows.continue" />: what you watched in the last 16 weeks, and new episodes of series you follow. OK resumes right away. Older titles you haven't finished stay in [Mine](/docs/watch/mine).
- <Ui k="home.rows.library" />: titles in your library.
- <Ui k="home.rows.newEpisodes" />: fresh episodes of series you watch.
- <Ui k="home.rows.watchlist" /> and the collections shown on home.

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

OK on a poster opens the title page. The first screen has the logo, ratings, year, runtime or number of seasons, the age rating and the description. If the description doesn't fit, focus it and press OK to read it all.

The buttons:

- **<Ui k="title.watch" />** opens the [Sources](/docs/watch/sources) screen to pick a release. If you've started the title, the button reads **<Ui k="title.resume" />** and plays right away, with what's next in the second line. If the episode is in your library, it plays from the server disk.
- **<Ui k="download.movie" />**, or download the selected season: files go to your library. See [Download and keep](/docs/watch/download-keep).
- **<Ui k="follow.follow" />**: new episodes download on their own. See [Follow](/docs/watch/follow).
- Icon buttons: <Ui k="title.sources" /> (when <Ui k="title.watch" /> plays right away), <Ui k="actions.watchlist" />, <Ui k="actions.rate" /> and <Ui k="actions.more" />, which opens the actions menu.

Until the server has an indexer, the showcase works as a media library. Titles from your library play as usual. Other titles have no <Ui k="title.watch" />, download or <Ui k="follow.follow" /> buttons: you can add them to <Ui k="actions.watchlist" /> and rate them. See [Indexers](/docs/setup/indexers).

Press down for the rest of the page:

- **<Ui k="title.episodes" />** of a series: season chips and a row of episodes. OK on an episode marks it watched or clears the mark; episodes are watched through <Ui k="title.watch" />. The first tile, <Ui k="title.episodeList.open" />, opens the season as a list with descriptions.
- **<Ui k="title.aboutMovie" />** or **<Ui k="title.aboutSeries" />**: release dates, budget, countries, studios and other facts, plus chips of genres, studios and tags.
- **<Ui k="title.cast" />** and **<Ui k="title.crew" />**. OK opens a person with their photo, biography and films by role.
- **<Ui k="title.franchise" />** for a movie from a series of films, and **<Ui k="title.similar" />**.

## The remote

| Key | What it does |
|---|---|
| Arrows | Move the focus. Left from the content opens the side menu |
| **OK** | Open or select what's in focus |
| Hold **OK** | Open the actions menu of a poster |
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

## If something went wrong

- **<Ui k="state.unauthorized.title" />.** The device lost its connection to the server. Select <Ui k="state.connect" /> and enter the new code. See [A device says it is not connected](/docs/troubleshooting#not-connected).
- **<Ui k="state.notConfigured.title" />.** The server has no TMDB key. See [No TMDB key](/docs/troubleshooting#tmdb-key-missing).
- **<Ui k="state.unavailable.title" />.** The server can't reach TMDB. See [The showcase says TMDB is unavailable](/docs/troubleshooting#tmdb-unavailable). Your own rows still show without it.
- **The TV doesn't show a code.** See [The TV doesn't show a code](/docs/troubleshooting#tv-no-code).

## Next

[Sources and audio](/docs/watch/sources): pick a release and start watching.
