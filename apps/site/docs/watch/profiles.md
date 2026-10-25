---
title: Profiles and PIN
description: "Profiles for each member of the household: choosing one on the TV, PIN, profile language and what the age limit does today."
---

# Profiles and PIN

Each member of the household can have a profile: their own watch history, lists, ratings and showcase language. Profiles are created in the control panel and picked on the TV.

::: tip What you'll learn
How to choose and switch profiles on the TV, protect a profile with a PIN, set its language, and what an age limit does today.
:::

## Choose a profile on the TV

When a device connects, or when nobody is selected, the TV asks <Ui k="profiles.title" />. If the server has only one profile and it has no PIN, the TV picks it by itself.

Select an avatar and press OK. A profile with a lock asks for its PIN first.

The device remembers the profile. Next time the TV opens straight on the home screen.

## Switch profiles

Your avatar and name are near the bottom of the side menu. Select them to return to <Ui k="profiles.title" /> and pick another profile. The showcase reloads for the new viewer: Back doesn't return to the previous viewer's screens.

## What a profile keeps

| Per profile | Per device, shared by profiles |
|---|---|
| Watch history and positions | <Ui k="settings.screensaver" /> |
| <Ui k="mine.sections.watchlist" />, <Ui k="mine.sections.favorites" />, ratings, watched and dropped titles | Sort and filters on <Ui k="sources.title" /> and in <Ui k="nav.mine" /> |
| Showcase language | Recent searches |
| Subtitle size and background, <Ui k="player.settings.autoNext" /> | |
| Service ratings on posters | |

Collections, the library and [following](/docs/watch/follow) are shared by the household.

## Create a profile

In the panel, open <Ui k="panel.nav.people" /> and select <Ui k="panel.people.profiles.add" />. Fill in:

- **<Ui k="panel.people.profileDialog.name" />** and **<Ui k="panel.people.profileDialog.color" />**: the avatar is the first letter on that color.
- **<Ui k="panel.people.profileDialog.language" />**: see below.
- **<Ui k="panel.people.profileDialog.ageLimit" />**: see below.
- **<Ui k="panel.people.profileDialog.pin" />**: optional, 4 digits.
- **<Ui k="panel.people.profileDialog.posterRating" />**: which service ratings appear on posters, for example TMDB.

One profile is marked <Ui k="panel.people.profiles.default" />: the panel owner and TVs without a selected profile watch as it. See [Profiles and devices](/docs/panel/profiles-devices).

Changes reach the TV the next time it loads the profile.

## PIN

A PIN keeps others from switching to a profile. Set it when you create the profile, or later from the profile's menu: <Ui k="panel.people.profiles.setPin" />, <Ui k="panel.people.profiles.changePin" /> or <Ui k="panel.people.profiles.removePin" />.

On the TV, type the four digits with the remote's number keys or on the keypad on screen. The fourth digit checks the PIN. Back erases a digit, and with no digits it goes back to the profiles.

Five wrong attempts lock the profile on that TV for 5 minutes. Other devices are not affected.

## Profile language

The showcase language sets the interface and the descriptions of titles on the TV: English or Russian. With <Ui k="panel.people.profiles.deviceLanguage" />, the TV uses its own language if Torsher has it, and English otherwise.

## Age limit

An age limit can be 6+, 12+, 16+ or 18+. The catalog isn't filtered by age yet: a profile with a limit sees the same titles. Today the limit only keeps the profile from changing what the household shares:

- it doesn't see <Ui k="home.rows.libraryUnmatched" /> and can't set titles for downloads;
- it sees the rules of followed titles but can only stop following.

## Delete a profile

In the profile's menu in the panel, delete it and choose what happens to its watch history: move it to another profile or delete it. Devices that used the profile switch to the default one, or ask <Ui k="profiles.title" /> if the default profile has a PIN.

## If something went wrong

- **Wrong PIN.** The TV shows how many attempts are left. Forgot the PIN? Set a new one in the panel with <Ui k="panel.people.profiles.changePin" />.
- **Too many attempts.** Wait for the time shown on the TV, then try again.
- **<Ui k="profiles.pin.error" />** The server didn't answer. Check that it's running and try again.
- **The TV suddenly asks who's watching.** The profile was deleted, or the default profile got a PIN. Pick a profile.

## Next

[Follow](/docs/watch/follow): new episodes download into your library on their own.
