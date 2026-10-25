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
- **<Ui k="panel.people.profileDialog.ageLimit" />:** 6+, 12+, 16+, 18+ or <Ui k="panel.people.profileDialog.noLimits" />. The catalog isn't filtered by age yet. For now, a profile with a limit can't match unrecognized downloads to titles on the TV.
- **<Ui k="panel.people.profileDialog.posterRating" />.** Which service ratings appear at the bottom of posters on the TV: <Ui k="panel.people.posterRatings.tmdb" /> and <Ui k="panel.people.posterRatings.imdb" />. IMDb ratings appear only when they are turned on in [Settings](/docs/panel/settings#metadata). The profile's own rating is always shown.
- **<Ui k="panel.people.profileDialog.pin" />,** when creating a profile: 4 digits.

Changes apply on the TV the next time it loads the profile.

### PIN

<Ui k="panel.people.profiles.setPin" />, <Ui k="panel.people.profiles.changePin" /> and <Ui k="panel.people.profiles.removePin" /> are in the profile's menu and card. The TV asks for the PIN when someone switches to this profile. Five wrong attempts lock the profile on that TV for 5 minutes.

### Delete a profile

The only profile can't be deleted. When you delete one, choose what happens to its watch history:

- <Ui k="panel.people.deleteDialog.move" />: positions and episode progress go to the profile you pick.
- <Ui k="panel.people.deleteDialog.drop" />.

Devices that used it switch to the default profile, or ask who's watching if the default profile has a PIN.

## A profile's card

Click a profile to open its card: color, language, PIN, age limit, devices, and:

- **<Ui k="panel.history.recent" />.** The last titles watched. The link below them opens the full watch history: every movie and series with the last episode, when it was watched, and how much is left.
- **<Ui k="panel.imports.section" />.** See below.

## Import ratings and lists

Bring a profile's ratings and Watchlist from another service, or move a profile from another Torsher server.

1. In the profile's card, select <Ui k="panel.imports.start" />.
2. Drop the files, up to 20 MB together:
   - <Ui k="panel.imports.sources.imdb" />: the ratings and watchlist CSV files;
   - <Ui k="panel.imports.sources.letterboxd" />: the whole export zip;
   - <Ui k="panel.imports.sources.trakt" />: the whole export zip;
   - a CSV in the Letterboxd import format with `tmdbID` or `imdbID` columns, which converters for other services produce;
   - <Ui k="panel.imports.sources.torsher" />: a profile export `.json` from another Torsher server.
3. Select <Ui k="panel.imports.dialog.upload" />. Torsher matches the rows with the catalog. You can close the window meanwhile: the profile card shows the progress.
4. Check the preview: new ratings, new titles for the lists, what is already in the profile, and ratings that differ from yours. For those, choose <Ui k="panel.imports.policies.keep" />, <Ui k="panel.imports.policies.replace" /> or <Ui k="panel.imports.policies.newer" />.
5. Select <Ui k="panel.imports.dialog.apply" />.

Only your own data is read from the files: title IDs, your ratings, dates and lists.

- **Rows that didn't match.** The profile card links to them. Confirm a suggested title or find one yourself. They wait there for 90 days.
- **Undo.** The card shows the last import with <Ui k="panel.imports.undo" />. Everything it changed goes back, except titles you changed after the import.
- **<Ui k="panel.imports.export" />** saves the profile as a file to import on another Torsher server. To move the whole server, see [Backup and move](/docs/maintain/backup#move-data-into-another-server).

## Devices

Each row shows the device's name, type, the profile it uses and <Ui k="panel.people.devices.watching" /> when it plays something.

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
