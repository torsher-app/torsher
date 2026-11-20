---
title: Mine
description: "Your viewing diary, rewatches, monthly overview, recommendations and personal lists, on the TV or in a browser."
---

# Mine

<Ui k="nav.mine" /> gathers your viewing diary, overview, recommendations, lists and the schedule of your series. Use it on the TV or open the showcase in a browser. Your diary, notes and preferences belong to your profile; collections are shared by the household.

::: tip What you'll learn
How to record and revisit watches, choose something to watch, manage your lists and bring your history over from another service.
:::

## Sections

Sections are on the left. Lists have counts; the overview and recommendations do not. The first visit opens <Ui k="mine.sections.continue" />. Later visits restore the section you explicitly chose for this profile. Move to a section to see its content:

- **<Ui k="mine.sections.continue" />**: unfinished movies and series, including the current episode of an active rewatch. The row on home shows only the last 16 weeks. Paused and hidden continuations stay out of the ordinary list until you restore them.
- **<Ui k="mine.preview.sections.recommendations" />**: a short selection from your Watch later list and new suggestions.
- **<Ui k="mine.preview.sections.overview" />**: your viewing activity and interests for the selected period.
- **<Ui k="mine.preview.sections.diary" />**: individual watches, including rewatches and entries without a known date.
- **<Ui k="mine.sections.schedule" />**: upcoming and recent episodes of the series you follow or watch. See [Follow](/docs/watch/follow#check).
- **<Ui k="mine.sections.watchlist" />** and **<Ui k="mine.sections.favorites" />**.
- **<Ui k="mine.sections.ratings" />**: every movie and series you rated, including series without viewing progress. Sort by <Ui k="mine.sort.rated" /> or by your rating.
- **<Ui k="mine.collections" />**: one section per collection your profile can see.
- **<Ui k="mine.sections.watched" />**: finished or marked titles and rated movies. Rating a series does not mark its episodes as watched.
- **<Ui k="mine.sections.dropped" />**: titles you gave up on.

Chips above the grid sort and filter it: <Ui k="mine.panel.sort" /> (<Ui k="mine.sort.added" /> or <Ui k="mine.sort.rating" />), <Ui k="mine.panel.kind" /> and <Ui k="mine.panel.rating" />. This TV remembers them for each section.

The grid loads more posters as you scroll. In a long list, Back jumps to the first poster, and Back again goes home. Page Up and Page Down move a screen at a time on a keyboard or a remote that has them; LG remotes don't pass their channel keys to apps.

## Viewing diary

<Ui k="mine.preview.sections.diary" /> keeps each watch separately. Finishing playback in an updated Torsher showcase can add an entry automatically. A seek to the end or a lone end event is not enough. Older clients and Jellyfin-compatible players still save their usual progress; automatic diary entries from every external player are not guaranteed.

To add a past watch yourself, select <Ui k="mine.personal.logWatch" /> from a title or episode's actions, or from the diary. Choose a date, or <Ui k="mine.preview.diary.undated" /> if you do not know it. A series can be recorded as one title-level entry with <Ui k="mine.personal.seriesWithoutEpisodes" />; this does not tick every episode as watched. A manually added rewatch can be marked as a rewatch explicitly.

The same day, month and year selectors work on the TV and in a browser. Use up/down to move between rows and to the action buttons, left/right or the on-screen chevrons to change a value, and OK or Enter on <Ui k="panel.common.save" /> to save. Quick choices let you select today, yesterday or no date. In a browser, you can also search and write a note with your impressions or who watched with you. A note on an entry belongs to that watch; <Ui k="mine.personal.titleNote" /> belongs to the title across watches. Neither is sent to TMDB for recommendations.

The diary runs from newest to oldest. The chips filter movies, episodes, rewatches or entries without a date. <Ui k="mine.preview.diary.jumpMonth" /> jumps to a month without cutting off the surrounding history. Entries with no date stay in a separate group; a date-only entry has no invented time. Times and day boundaries use the server's diary time zone.

Press OK on an entry to open its actions. You can open the title, watch it again, edit its date, read its note or delete the entry. Notes can be edited in the browser. Deleting a diary entry does not remove a watched mark or delete a media file. Removing a watched mark does not erase the diary either. After adding a watch, the brief <Ui k="mine.preview.recommendations.undo" /> action removes that entry and keeps the independent watched mark. With a remote, Down from the returned card reaches Undo; Up or Back returns to the card.

## Overview

<Ui k="mine.preview.sections.overview" /> starts with a month. Its movie and episode tiles count watches, so watching the same movie twice counts twice. Rewatches are part of those watches, not an extra set to add to the total. Active days count dates with at least one dated entry. Recording a whole series without specific episodes adds a diary entry but does not invent an episode count.

Select a movie, episode or rewatch tile to open the records behind it. The days tile focuses the calendar. A calendar cell shows its date and number of watches; moving to it previews up to four records beside the calendar. This side panel is an informational preview. Press OK or click a date with watches to open the full day in the diary; the reminder below the preview is not a button. The selected month applies to all these figures. In a browser, hover or focus a tile to see distinct-title details.

<Ui k="mine.preview.recent" /> opens recently watched titles. Genre and country interests count distinct titles with known metadata; their detail view also shows how many diary entries those titles produced. Missing metadata can make these groups incomplete.

An existing profile does not get a made-up history on its first day. Earlier watched marks remain available separately, and interests can use your ratings and favorites until dated diary entries exist. An empty month does not mean the entire diary is empty.

## Choose what to watch

<Ui k="mine.preview.sections.recommendations" /> shows at most 12 candidates. Filters start unrestricted: choose a type, length, genre or source when you need one. A strict length filter excludes titles whose exact runtime is unknown. For a series, the length refers to a confirmed aired episode, not the whole series.

The preview above the posters explains the focused suggestion using a real signal: a rating, favorite, previous watch, a Watch later date or the genre you selected. A profile without personal signals can get general catalog suggestions. Suggestions do not promise that a playable file has already been found or downloaded.

The preview stays visible while rows of four posters scroll below it. <Ui k="mine.preview.recommendations.random" /> focuses one of the candidates already shown; it does not request a different catalog batch. <Ui k="mine.preview.recommendations.actions.hide" /> removes a suggestion from this profile's results. You can restore it from <Ui k="mine.preview.recommendations.source.hidden" />.

Your own marks and exclusions take effect when the selection is read again. New catalog candidates are refreshed in a limited background queue; repeatedly focusing a poster or changing a rating does not start an unlimited set of requests. During a catalog outage, local Watch later choices can still be useful, but new suggestions may be unavailable.

## Rewatches and continuation

<Ui k="mine.personal.startRewatch" /> creates a separate cycle for a series: choose its starting episode. Replaying a movie starts another watch and can add another diary entry; it does not create a series cycle. Its position takes priority in <Ui k="mine.sections.continue" /> while the rewatch is active, and its watches add new diary entries. It does not overwrite your ordinary viewing position or shared follow rules.

<Ui k="mine.personal.pauseRewatch" /> suspends that rewatch; <Ui k="mine.personal.resumeRewatch" /> continues it. <Ui k="mine.personal.endRewatch" /> ends its priority and uses the ordinary position as it is now, including playback saved by another client in the meantime. It does not restore an old snapshot over newer progress.

For an ordinary continuation, <Ui k="mine.personal.pauseContinue" /> and <Ui k="mine.personal.hideContinue" /> control whether it appears in Continue. These actions keep history and files. Their brief <Ui k="mine.preview.recommendations.undo" /> action restores the previous continuation setting. Use the paused or hidden list to resume or restore it. <Ui k="actions.dropped" /> remains a separate choice for a title you gave up on.

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

Legacy title marks from the watched-title JSON format also put movies and series in <Ui k="mine.sections.watched" />, including ongoing series. They do not fill in episode checkboxes or add a viewing date to history. Starting playback or removing the watched mark clears the imported mark; a later import can add it again. <Ui k="status.dropped" /> keeps priority until you resume playback. Diary-based watched facts, including supported history imports, stay until you explicitly remove the watched mark; starting playback does not clear them. Following a series, its schedule and downloads continue as before.

Jellyfin-compatible clients keep their file and episode progress: a title mark does not mark files as played, change Resume or Next Up, or allow automatic file cleanup.

The actions menu shows the title's status under its name: <Ui k="status.watching" />, <Ui k="status.waiting" />, <Ui k="status.watched" /> or <Ui k="status.dropped" />.

## Collections

A collection is a list of your household, like “Holidays” or “With kids”. It's shared by all profiles on the server.

1. Create it in the panel under <Ui k="panel.nav.collections" />. There you also choose <Ui k="panel.collections.dialog.showOnHome" /> and which profiles see it. See [Collections](/docs/panel/collections).
2. On the TV, hold OK on a poster, pick <Ui k="actions.collections" /> and tick the collections. OK on a ticked one removes the title.

A collection appears in <Ui k="nav.mine" /> and, if it's shown on home, as a row on <Ui k="nav.home" />.

## Import ratings, Watch later and watched titles

Bring your ratings and watchlist from IMDb, Letterboxd or Trakt, viewing history from supported Letterboxd and Trakt exports, import watched title marks with the [Torsher JSON format](/docs/panel/profiles-devices#watched-title-file), or move a profile from another Torsher server. Import works in the panel:

1. Export your data from the service: the ratings and watchlist CSV from IMDb, or the whole export zip from Letterboxd or Trakt. A CSV in the Letterboxd import format with TMDB or IMDb IDs also works.
2. In the panel, open <Ui k="panel.nav.people" />, find the profile and select <Ui k="panel.imports.start" /> under <Ui k="panel.imports.section" />.
3. Upload the files, up to 20 MB together. Torsher matches every row with the catalog.
4. Check the preview: ratings and lists, individual diary entries, watched marks and other personal changes are counted separately. Choose which rating wins and select <Ui k="panel.imports.dialog.apply" />.

Rows that didn't find a title wait in the profile card for 90 days: match them by hand or hide them. <Ui k="panel.imports.undo" /> rolls the import back while preserving later changes. A dated diary row, an undated watched mark and an aggregate watch count are different: Torsher does not expand an aggregate into invented watches. See [Profiles and devices](/docs/panel/profiles-devices#import-ratings-lists-and-watched-titles) for supported files and date precision.

Torsher reads only the files you upload. It doesn't sign in to these services or open their pages.

## If something went wrong

- **<Ui k="actions.noCollections" />** See [Collections](/docs/panel/collections).
- **<Ui k="actions.errors.save" />** The server didn't answer. Your change was not saved; try again.
- **<Ui k="mine.emptyFiltered.title" />.** Reset the chips above the grid.

## Next

[Profiles and PIN](/docs/watch/profiles): profiles for each member of the household.
