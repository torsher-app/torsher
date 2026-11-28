---
title: Profiles and devices
description: "Profiles of the household and the devices connected to the server: name, color, language, PIN, age limit, poster ratings, connecting a device with a code, watch history, and importing ratings and lists."
---

# Profiles and devices

<Ui k="panel.nav.people" /> has two lists: the household's profiles and the TVs, browsers and other devices connected to the server. A profile keeps its own watch history, lists, ratings and showcase language. Profiles are chosen on the TV, see [Profiles and PIN](/docs/watch/profiles).

::: tip What you'll learn
How to set up profiles, connect and disconnect devices, see what a profile watched, and bring ratings and lists over from other services.
:::

## Profiles

Each row shows the profile's name, <Ui k="panel.people.profiles.pin" /> if it has one, its age limit, and the devices that use it. One profile is marked <Ui k="panel.people.profiles.default" />: the panel owner and TVs without a chosen profile watch as it. If it has a PIN, such TVs ask who's watching first.

### Create or edit a profile

Select <Ui k="panel.people.profiles.add" />, or <Ui k="panel.people.profiles.edit" /> in a profile's menu:

- **<Ui k="panel.people.profileDialog.name" />** and **<Ui k="panel.people.profileDialog.color" />.**
- **<Ui k="panel.people.profileDialog.language" />.** The interface and descriptions on the TV. <Ui k="panel.people.profiles.deviceLanguage" /> follows the TV.
- **<Ui k="panel.people.profileDialog.ageLimit" />:** 6+, 12+, 16+, 18+ or <Ui k="panel.people.profileDialog.noLimits" />. Titles rated at or above the threshold, and titles without a known rating, are hidden in the showcase and Jellyfin-compatible clients. Home videos and unrecognized downloads are hidden too. The owner’s panel catalog remains available for administration.
- **<Ui k="panel.people.profileDialog.posterRating" />.** Which service ratings appear at the bottom of posters on the TV: <Ui k="panel.people.posterRatings.tmdb" /> and <Ui k="panel.people.posterRatings.imdb" />. IMDb ratings appear only when they are turned on in [Settings](/docs/panel/settings#metadata). The profile's own rating is always shown.
- **<Ui k="panel.people.profileDialog.pin" />,** when creating a profile: 4 digits.

Changes apply on the TV the next time it loads the profile.

### PIN

<Ui k="panel.people.profiles.setPin" />, <Ui k="panel.people.profiles.changePin" /> and <Ui k="panel.people.profiles.removePin" /> are in the profile's menu and card. The TV asks for the PIN when someone switches to this profile. Five wrong attempts lock the profile on that TV for 5 minutes.

### Delete a profile

The only profile can't be deleted. When you delete one, choose what happens to its watch history:

- <Ui k="panel.people.deleteDialog.move" />: positions and episode progress go to the profile you pick.
- <Ui k="panel.people.deleteDialog.drop" />.

Devices that used it switch to the default profile, or ask who's watching if the default profile has a PIN. [Jellyfin-compatible connections](/docs/tv/jellyfin-compatible) instead lose access when their attached profile is deleted.

## A profile's card

Click a profile to open its card: color, language, PIN, age limit, devices, and:

- **<Ui k="panel.history.recent" />.** The last titles watched. The link below them opens the full watch history: every movie and series with the last episode, when it was watched, and how much is left.
- **<Ui k="panel.imports.section" />.** See below.

This position history is separate from the personal viewing diary in <Ui k="nav.mine mine.preview.sections.diary" />. The diary keeps individual viewing entries, their dates and notes rather than treating an updated playback position as another viewing.

## Import personal history and lists {#import-ratings-lists-and-watched-titles}

Bring a profile's ratings, lists and viewing history from supported Letterboxd or Trakt files, or move a profile from another Torsher server. IMDb files supply ratings and Watchlist, not a dated viewing diary.

1. In the profile's card, select <Ui k="panel.imports.start" />.
2. Drop the files, up to 20 MB together:
   - <Ui k="panel.imports.sources.imdb" />: the ratings and watchlist CSV files;
   - <Ui k="panel.imports.sources.letterboxd" />: the whole export zip;
   - <Ui k="panel.imports.sources.trakt" />: the whole export zip;
   - a CSV in the Letterboxd import format with `tmdbID` or `imdbID` columns, which converters for other services produce;
   - <Ui k="panel.imports.sources.torsher" />: a profile export `.json` from another Torsher server, or a watched title file in the format below.
3. Select <Ui k="panel.imports.dialog.upload" />. Torsher matches the rows with the catalog. You can close the window meanwhile: the profile card shows the progress.
4. Check the preview: ratings, list entries, watched marks and diary entries are separate. Native Torsher files also show changes to <Ui k="panel.imports.preview.personal" />. For conflicting ratings, choose <Ui k="panel.imports.policies.keep" />, <Ui k="panel.imports.policies.replace" /> or <Ui k="panel.imports.policies.newer" />.
5. Select <Ui k="panel.imports.dialog.apply" />.

Only your own data is read from the files: title IDs, your ratings, dates, lists and viewing notes. Torsher does not sign in to these services or open URLs in the files.

- **Rows that didn't match.** The profile card links to them. Confirm a suggested title or find one yourself. Use <Ui k="panel.titlePreview.details" /> to check the poster and overview, then <Ui k="panel.titlePreview.select" /> to return with that title selected. Save the match in the search dialog. Unmatched rows wait there for 90 days.
- **Undo.** The card shows the last import with <Ui k="panel.imports.undo" />. An imported change is undone only if its affected data has stayed untouched. A later edit, explicit watched/unwatched action or manual confirmation is kept. Related diary and seen changes are checked together. A match you confirm later is a separate action, outside the original batch's undo.
- **<Ui k="panel.imports.export" />** saves the profile as a file to import on another Torsher server. To move the whole server, see [Backup and move](/docs/maintain/backup#move-data-into-another-server).

### Dates and repeated imports

Letterboxd diary rows use the watch date, without inventing a time of day. Recognized Trakt history rows keep each event's identity and exact episode. Events with no known watch date remain undated. A watched list or an aggregate play count confirms that you have seen something; it does not manufacture dated watches or repeats.

Repeating a recognized file does not add the same events again or overwrite diary edits made in Torsher. Without a source event ID, identical rows are distinguished within one uploaded dataset; separate exports with indistinguishable rows cannot prove additional viewings. Separately exported Letterboxd reviews enrich a diary entry only when their association is reliable. Deleted data and unrelated list contents are not restored as diary entries.

Imported diary entries and their personal watched marks do not create playback positions, start following a series or make files eligible for automatic cleanup. Removing a diary entry leaves its watched mark; explicitly clearing watched leaves the diary entry. The neutral watched-title file below keeps its earlier, separate behavior.

Export layouts can change. Torsher supports the recognized files and reports skipped or unresolved rows; support for every Trakt export variant is not guaranteed.

### Watched title file

A JSON file can carry title marks without ratings or episode history:

```json
{
  "format": "torsher-import",
  "version": 1,
  "entries": [
    { "list": "watched", "title": "Synthetic Beacon", "kind": "series", "year": 2020 }
  ]
}
```

Each entry needs `list: "watched"`, a non-empty `title`, and `kind: "movie"` or `"series"`. Optional fields are `originalTitle`, `year`, `tmdbId` and `imdbId`. Dates, ratings, seasons, episodes and positions are not part of this format. The same 20 MB limit applies, with at most 20,000 entries across the files.

Marks appear under <Ui k="mine.sections.watched" /> even for ongoing series. They do not create episode progress or viewing history. A movie leaves Watch later; a series keeps it. Existing viewing positions are preserved. Repeating the same import keeps the original mark. Starting playback or removing the mark clears it; applying a new import can add it again. Existing Dropped status keeps priority. See [Watched and dropped](/docs/watch/mine#watched-and-dropped) for the showcase and Jellyfin-compatible clients.

### Import watched marks from Jellyfin

Open <Ui k="panel.jellyfinImport.title" /> in the destination profile's card. The panel and the Jellyfin server both need HTTPS with trusted certificates. Torsher must be able to reach Jellyfin from its own network without using its loopback address. A Jellyfin reverse proxy with a base path is supported.

1. Enter the Jellyfin address, then select <Ui k="panel.jellyfinImport.checkAddress" /> and review the destination.
2. Sign in as the Jellyfin viewer whose watched marks you want to transfer. Select <Ui k="panel.jellyfinImport.preview" /> to compare the snapshot with the destination profile.
3. Select <Ui k="panel.imports.dialog.apply" />. If needed, undo the applied import from the profile card.

Torsher imports watched marks for matched movies and episodes. Playback position, watch dates and repeat watches stay in Jellyfin. These marks do not make files eligible for automatic cleanup. Torsher uses a temporary Jellyfin session for the import and discards the credentials after use.

### Sync completed watches with Simkl

Register a public Device client using [Simkl AUTH V2](https://api.simkl.org/authentication), then set its ID as `SIMKL_CLIENT_ID` in your server environment. The setting is empty by default. Open <Ui k="panel.simklSync.title" /> in the profile's card and choose <Ui k="panel.simklSync.connect" />. Open Simkl, enter the activation code, and check the account before enabling a direction.

- <Ui k="panel.simklSync.pull" /> imports supported watched movies and episodes into your Torsher diary. Use <Ui k="panel.simklSync.sync" /> to check for new watches immediately.
- <Ui k="panel.simklSync.push" /> sends future completions from the Torsher player. Simkl receives the movie or episode ID and completion time. Manual marks, existing diary entries, notes, ratings and unfinished playback are outside this sync.

Simkl keeps one canonical watched entry per movie or episode. Repeat watches stay in the Torsher diary. Additions made before a disconnect stay on both sides. A restored Torsher backup needs a new connection before sync can resume. Keep system files and data-volume snapshots private because they may contain live credentials.

## Devices

Each row shows the device's name, type, the profile it uses and <Ui k="panel.people.devices.watching" /> when it plays something.

Select <Ui k="panel.nav.logs" /> in a device’s menu to open its related journal entries.

### Connect a device

1. Open Torsher on the TV or in a browser: it shows a six-character code.
2. Select <Ui k="panel.people.pairDevice" />.
3. Enter the <Ui k="panel.people.pair.code" /> and a <Ui k="panel.people.pair.name" />, then select <Ui k="panel.people.pair.submit" />.

A code is valid for 10 minutes. The profile is chosen on the device itself. See [Connect a device](/docs/tv/connect).

### Rename or disconnect

In a device's menu, <Ui k="panel.people.devices.rename" /> changes its name in the list. <Ui k="panel.people.devices.revoke" /> signs it out: the device has to connect again with a new code.

## If something went wrong

- **<Ui k="panel.people.pair.errorTitles.invalid" />** or **<Ui k="panel.people.pair.errorTitles.expired" />.** Enter the code the device shows right now. See [The code is not accepted](/docs/troubleshooting#code-rejected).
- **A device says it is not connected.** See [A device says it is not connected](/docs/troubleshooting#not-connected).
- **<Ui k="panel.imports.dialog.failedTitle" />.** Titles can't be matched without TMDB. Check the TMDB key and the network in [Settings](/docs/panel/settings#metadata), then upload the files again.

## Next

- [Logs](/docs/panel/logs).
- [Profiles and PIN](/docs/watch/profiles): what the TV shows.
