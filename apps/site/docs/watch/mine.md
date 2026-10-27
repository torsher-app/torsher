---
title: Mine
description: "Your personal lists on the TV: watch later, favorites, ratings, watched and dropped titles, household collections, and importing ratings from other services."
---

# Mine

<Ui k="nav.mine" /> gathers what you watch and what you plan to: lists, ratings, the schedule of your series and the collections of your household. Everything here belongs to your profile, except collections, which the household shares.

::: tip What you'll learn
How to add titles to your lists from any poster, rate them, use collections, and bring your ratings over from another service.
:::

## Sections

Sections are on the left, each with its count. Move to a section and the grid on the right follows:

- **<Ui k="mine.sections.continue" />**: movies and series you started, however long ago. The row on home shows only the last 16 weeks.
- **<Ui k="mine.sections.schedule" />**: upcoming and recent episodes of the series you follow or watch. See [Follow](/docs/watch/follow#check).
- **<Ui k="mine.sections.watchlist" />** and **<Ui k="mine.sections.favorites" />**.
- **<Ui k="mine.collections" />**: one section per collection your profile can see.
- **<Ui k="mine.sections.watched" />**: finished, marked and rated titles.
- **<Ui k="mine.sections.dropped" />**: titles you gave up on.

Chips above the grid sort and filter it: <Ui k="mine.panel.sort" /> (<Ui k="mine.sort.added" /> or <Ui k="mine.sort.rating" />), <Ui k="mine.panel.kind" /> and <Ui k="mine.panel.rating" />. This TV remembers them for each section.

The grid loads more posters as you scroll. In a long list, Back jumps to the first poster, and Back again goes home. Page Up and Page Down move a screen at a time on a keyboard or a remote that has them; LG remotes don't pass their channel keys to apps.

## Add a title to a list

Hold OK on any poster, on home, in search, in the catalog or right here, to open the actions menu. Pick <Ui k="actions.watchlist" />, <Ui k="actions.favorite" /> or <Ui k="actions.dropped" />; a tick shows what's on. The menu stays open, so you can set several at once.

On a title page, the <Ui k="actions.watchlist" /> button does the same in one press, and <Ui k="actions.more" /> opens the whole menu.

<Ui k="home.rows.watchlist" /> also appears as a row on home.

## Rate a title

Select <Ui k="actions.rate" /> in the actions menu or on the title page, then pick a number from 1 to 10. Digits on the remote rate at once, and 0 means 10. OK on the current rating, or <Ui k="rating.clear" />, removes it.

Your rating shows as a star at the top right of the poster. Ratings of services, such as TMDB, show at the bottom left; which ones is set per profile in the panel. See [Profiles and PIN](/docs/watch/profiles#create-a-profile).

## Watched and dropped

- **Watched.** A title becomes watched when you finish it. To mark it yourself, pick <Ui k="actions.markWatched" /> in the actions menu. On a title page, OK on an episode marks that episode.
- **Dropped.** <Ui k="mine.empty.dropped.text" />

The actions menu shows the title's status under its name: <Ui k="status.watching" />, <Ui k="status.waiting" />, <Ui k="status.watched" /> or <Ui k="status.dropped" />.

## Collections

A collection is a list of your household, like “Holidays” or “With kids”. It's shared by all profiles on the server.

1. Create it in the panel under <Ui k="panel.nav.collections" />. There you also choose <Ui k="panel.collections.dialog.showOnHome" /> and which profiles see it. See [Collections](/docs/panel/collections).
2. On the TV, hold OK on a poster, pick <Ui k="actions.collections" /> and tick the collections. OK on a ticked one removes the title.

A collection appears in <Ui k="nav.mine" /> and, if it's shown on home, as a row on <Ui k="nav.home" />.

## Import ratings and Watch later

Bring your ratings and watchlist from IMDb, Letterboxd or Trakt, or move a profile from another Torsher server. Import works in the panel:

1. Export your data from the service: the ratings and watchlist CSV from IMDb, or the whole export zip from Letterboxd or Trakt. A CSV in the Letterboxd import format with TMDB or IMDb IDs also works.
2. In the panel, open <Ui k="panel.nav.people" />, find the profile and select <Ui k="panel.imports.start" /> under <Ui k="panel.imports.section" />.
3. Upload the files, up to 20 MB together. Torsher matches every row with the catalog.
4. Check the preview: new ratings, new <Ui k="mine.sections.watchlist" /> entries, and ratings that differ from yours. Choose which rating wins and select <Ui k="panel.imports.dialog.apply" />.

Rows that didn't find a title wait in the profile card for 90 days: match them by hand or hide them. <Ui k="panel.imports.undo" /> rolls the import back, except titles you changed since.

Torsher reads only the files you upload. It doesn't sign in to these services or open their pages.

## If something went wrong

- **<Ui k="actions.noCollections" />** See [Collections](/docs/panel/collections).
- **<Ui k="actions.errors.save" />** The server didn't answer. Your change was not saved; try again.
- **<Ui k="mine.emptyFiltered.title" />.** Reset the chips above the grid.

## Next

[Profiles and PIN](/docs/watch/profiles): profiles for each member of the household.
