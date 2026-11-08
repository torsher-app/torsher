---
title: Following
description: "Follows of every profile in the panel: rules, what is waiting, downloading, ready or not found, why a release was rejected, the activity of the automation and its notifications."
---

# Following

<Ui k="panel.nav.follow" /> in the panel lists every title followed on the server, by any profile. Here you change rules, see every release found for an episode and why it was rejected, and follow what the automation did. To start following another title, select <Ui k="panel.follow.chooseInShowcase" />. The showcase opens in a new tab; choose a title and follow it with your profile. See [Follow](/docs/watch/follow).

::: tip What you'll learn
Where to look when an episode doesn't arrive, how to change a follow's rules, how to stop a release from being taken, and which notifications following sends.
:::

## Before you start

- To inspect a follow, first subscribe to a title in the showcase. If the list is empty, <Ui k="panel.follow.chooseInShowcase" /> takes you there. The same action stays available above an existing list.

## The list

Follows are grouped:

- **<Ui k="panel.follow.groups.attention" />.** Episodes that don't fit on the disk, episodes with no releases long after they aired, and releases that look like the title but need your answer.
- **<Ui k="panel.follow.groups.waiting" />.** Something is being searched, held back or downloaded, or the next episode is announced.
- **<Ui k="panel.follow.groups.done" />.** Every aired episode the follow covers is in the library or, with <Ui k="panel.follow.modes.series.notify.title" />, ready to watch.
- **<Ui k="panel.follow.groups.stopped" />.** Paused follows and follows that no profile is subscribed to.

Each row shows the rules in a phrase, the next episode and the state. Click a row to open its card.

## A follow's card

Rules apply to every subscribed profile, whether changed in this panel or in the showcase. The form states this before its controls; the profiles listed in the card show who shares the follow.

- **<Ui k="panel.follow.rules.title" />.** The same rules as on the TV, including <Ui k="panel.follow.rules.mode" />: <Ui k="panel.follow.modes.series.download.title" /> or <Ui k="panel.follow.modes.series.notify.title" /> (see [Download or notify](/docs/watch/follow#download-or-notify)), and <Ui k="panel.follow.rules.audio" />: the default source preset or a language for this title (see [Audio language](/docs/watch/follow#audio-language)). <Ui k="follow.studio.title" /> selects automatic, preferred, required or any studio (see [Studio](/docs/watch/follow#studio)). Choose a studio in the searchable list. Names and aliases are supported; typo suggestions require an explicit choice. Typing, clearing the query or closing the list does not change the selection. The studio rule is active for Russian audio; <Ui k="panel.follow.rules.russian" /> is only here. Select <Ui k="panel.follow.rules.save" /> to apply them.
- **<Ui k="panel.follow.card.profiles" />.** The profiles subscribed on the TV.
- **<Ui k="panel.follow.card.episodes" />.** Seasons and episodes the follow covers, with their state: <Ui k="panel.follow.episodeStates.upcoming" />, <Ui k="panel.follow.episodeStates.searching" />, <Ui k="panel.follow.episodeStates.waiting" />, <Ui k="panel.follow.episodeStates.downloading" />, <Ui k="panel.follow.episodeStates.in_library" />, <Ui k="panel.follow.episodeStates.ready" />, <Ui k="panel.follow.episodeStates.no_space" /> or <Ui k="panel.follow.episodeStates.missing" />. Click an episode to see the releases of the last check: <Ui k="panel.follow.candidates.verdicts.grab" /> (<Ui k="panel.follow.candidates.verdicts.picked" /> when the follow only notifies), <Ui k="panel.follow.candidates.verdicts.pending" /> or <Ui k="panel.follow.candidates.verdicts.rejected" />, with the reason in plain words, such as no Russian audio track, no original audio track, a screen recording, or waiting for your voice-over until a set time.
- **<Ui k="panel.follow.candidates.block" />.** Next to a release in that list that wasn't taken, and next to the picked release when the follow only notifies. Torsher never takes it for this title, it goes to the blocklist, and an episode that lost its picked release gets a new one.
- **<Ui k="panel.follow.actions.searchNow" />.** Searches your indexers within a minute, outside the hourly limit. The card shows when the last search was and when the next one is due.
- **<Ui k="panel.follow.actions.pause" />** stops searching and downloading but keeps the rules and the profiles. **<Ui k="panel.follow.actions.delete" />** removes the follow and unsubscribes the profiles. In both cases downloaded files stay in the library. A new profile can subscribe while the follow is paused, but only resuming it in the panel restarts automation.

## Remove watched downloads automatically {#library-maintenance}

Set up <Ui k="panel.maintenance.commonRule" /> once in <Ui k="panel.nav.settings panel.settings.nav.storage" />. It covers all current and future followed titles. Use <Ui k="panel.maintenance.preview" /> to see which groups qualify before saving. Automatic deletion requires the separate <Ui k="panel.maintenance.execution" /> switch, initially off.

To keep one series indefinitely or give it a different retention period, select <Ui k="panel.maintenance.addRule" /> in Storage. The follow card’s <Ui k="panel.maintenance.configure" /> opens the same form for that title. An exception with deletion off protects the title. <Ui k="panel.maintenance.useCommon" /> removes the exception after confirmation.

Set <Ui k="panel.maintenance.days" /> and <Ui k="panel.maintenance.profiles" />, initially all profiles. Every selected profile must have marked the movie or every episode in a file as watched. The period starts from the latest of those watched dates and any profile's last playback. Watching again postpones removal. Adding or removing a profile pauses the rule until the owner reviews its selection.

For series, <Ui k="panel.maintenance.keepLast" /> can protect the latest N available episodes. This keeps a minimum, rather than limiting the library to N episodes: unwatched episodes stay too. Episodes still downloading do not displace available ones. Specials and uncertain matches are excluded.

Only new files automatically downloaded by following, with a known history, can qualify. Existing collections, manual downloads, connected folders and home videos are excluded. A favorite in any profile protects the whole title. <Ui k="panel.maintenance.protect" /> protects an automatically saved group of files, including one whose torrent has already left the cache.

The preview lists every reason a group is kept. Cleanup removes whole eligible torrent groups: one protected or unwatched episode keeps the entire pack. Seeding goals must be met; unlimited seeding prevents cleanup. Pausing or removing a follow prevents new cleanup operations.

Eligible groups wait at least 24 hours before removal. Changing a rule, removing protection or watching again restarts eligibility checks. Cleanup preserves watch history and prevents the removed episodes from being downloaded automatically again. <Ui k="panel.follow.actions.searchNow" /> does not clear that choice; use <Ui k="panel.maintenance.redownload" /> for an episode to allow it again.

::: warning Removal is permanent
There is no trash or undo. A database backup does not contain the video files. Torsher protects its own active playback, including paused sessions, but cannot see playback through another application such as Jellyfin or Plex. Keep automatic cleanup off if those applications need uninterrupted access to the shared files.
:::

Sizes in the preview are estimates by volume. Hard links, shared blocks and files open in other applications can change how much disk space is actually freed. Cleanup is independent of the cache limit and does not guarantee a maximum library size.

When a follow is waiting, its status shows the episode, the quality and audio of the held release when known, the preferred version and the deadline.

Tracked season topics are searched even when the catalog has no new episode listed. An incomplete topic whose version changed within the last 30 days is checked every 12 hours; other topics are checked every 3 days. Other search reasons can run sooner. These checks share the hourly search budget and pause when an indexer asks the server to wait.

## Activity

<Ui k="panel.follow.activity.title" /> opens from the button at the top of <Ui k="panel.nav.follow" />. Filter it by title and by event.

- **<Ui k="panel.follow.activity.tabs.queue" />.** Releases held back and until when, downloads of followed titles with their progress, and episodes waiting for space.
- **<Ui k="panel.follow.activity.tabs.history" />.** What Torsher found, downloaded, replaced, rejected and searched, for 90 days. A release that looks like the title but isn't certain has two buttons: <Ui k="panel.follow.unsure.confirm" /> remembers its name for this title and passes it to the automation, <Ui k="panel.follow.unsure.dismiss" /> drops it.
- **<Ui k="panel.follow.activity.tabs.blocklist" />.** Releases that stalled (no peers and no progress for 6 hours, kept out for 7 days), releases whose files lack episodes the name promises (when only some are missing, the row lists them, and only those are kept out), and releases you declined. Select <Ui k="panel.follow.blocklist.remove" /> to let one be taken again.

## Settings

<Ui k="panel.nav.settings panel.settings.nav.follow" />:

- **<Ui k="panel.settings.follow.rss.title" />.** Every 15 minutes by default, from 10 to 120 minutes. 0 turns the feed off, and follows find releases by targeted searches only.
- **<Ui k="panel.settings.follow.budget.title" />.** 20 by default, from 1 to 60. Fewer searches are gentler on your indexers.
- **<Ui k="panel.settings.follow.defaults.title" />.** Mode, the wait for series (a day by default) and movies (3 days), and the quality rule for new follows. Existing follows keep their rules. Language and translation-type priorities are managed in [Source presets](/docs/watch/sources#set-source-preferences).

Each indexer's card in <Ui k="panel.nav.sources" /> has a <Ui k="panel.sources.feed.label" /> line: when the feed was last read, and a switch to turn it off for that indexer. For indexers imported from Prowlarr the switch shows <Ui k="panel.sources.feed.managed" />: Torsher reads the feed if Prowlarr says the indexer supports it. An indexer that returns no feed three times in a row is tried again a week later.

## Notifications

Following uses the same notifications as the rest of the server. See [Settings](/docs/panel/settings).

| Notification | Where it goes |
| --- | --- |
| Episodes in the library, one message per title | Channels with the <Ui k="panel.notifications.groups.follow" /> group, and the panel bell |
| Episodes ready to watch, one message per title, for follows that only notify | Channels with the <Ui k="panel.notifications.groups.follow" /> group, and the panel bell |
| <Ui k="notifications.follow.missing.title" />: an episode aired a while ago and has no releases | Channels with the <Ui k="panel.notifications.groups.follow" /> group, and the panel bell |
| <Ui k="notifications.follow.waiting.titleVoice" />, <Ui k="notifications.follow.otherVoice.title" />, <Ui k="notifications.follow.upgraded.title" />, <Ui k="notifications.follow.topicUpdated.title" /> | The panel bell only |
| Not enough space for followed episodes; an indexer limiting or failing requests for over 6 hours | <Ui k="panel.nav.overview" /> as a problem, and channels with the <Ui k="panel.notifications.groups.problems" /> group |

New channels get the <Ui k="panel.notifications.groups.follow" /> group turned on. Downloads of followed titles don't send a separate finished-download notification.

## If something went wrong

- **An episode stays <Ui k="panel.follow.episodeStates.searching" />.** Open it in the card: an empty list means no indexer returned a release yet; rejected releases show why. Check that your indexers answer in <Ui k="panel.nav.sources" />, then select <Ui k="panel.follow.actions.searchNow" />.
- **<Ui k="panel.follow.episodeStates.no_space" />.** Free up space or change the limits in <Ui k="panel.nav.settings panel.settings.nav.storage" />. The download starts by itself; kept files are never removed to make room.
- **A wrong release was taken.** Remove its download in <Ui k="panel.nav.torrents" />. A release that is already taken has no <Ui k="panel.follow.candidates.block" /> button.
- **Releases of a title are never recognized.** Look in <Ui k="panel.follow.activity.tabs.history" /> for releases marked as not certain and confirm the right ones.

## Next

[Settings](/docs/panel/settings) for notification channels, or [Follow](/docs/watch/follow) for what the TV shows.
