---
title: Following
description: "Follows of every profile in the panel: rules, what is waiting, downloading or not found, why a release was rejected, the activity of the automation and its notifications."
---

# Following

<Ui k="panel.nav.follow" /> in the panel lists every title followed on the server, by any profile. Here you change rules, see every release found for an episode and why it was rejected, and follow what the automation did. Following itself starts on the TV. See [Follow](/docs/watch/follow).

::: tip What you'll learn
Where to look when an episode doesn't arrive, how to change a follow's rules, how to stop a release from being taken, and which notifications following sends.
:::

## Before you start

- At least one title is followed on the TV. Until then the page shows <Ui k="panel.follow.empty.title" />.

## The list

Follows are grouped:

- **<Ui k="panel.follow.groups.attention" />.** Episodes that don't fit on the disk, episodes with no releases long after they aired, and releases that look like the title but need your answer.
- **<Ui k="panel.follow.groups.waiting" />.** Something is being searched, held back or downloaded, or the next episode is announced.
- **<Ui k="panel.follow.groups.done" />.** Everything from the chosen episode is in the library.
- **<Ui k="panel.follow.groups.stopped" />.** Paused follows and follows that no profile is subscribed to.

Each row shows the rules in a phrase, the next episode and the state. Click a row to open its card.

## A follow's card

- **<Ui k="panel.follow.rules.title" />.** The same rules as on the TV, plus two that are only here: <Ui k="panel.follow.rules.startCustom" /> to start from any season and episode, and <Ui k="panel.follow.rules.russian" />. Select <Ui k="panel.follow.rules.save" /> to apply them.
- **<Ui k="panel.follow.card.profiles" />.** The profiles subscribed on the TV.
- **<Ui k="panel.follow.card.episodes" />.** Seasons and episodes from the chosen one, with their state: <Ui k="panel.follow.episodeStates.upcoming" />, <Ui k="panel.follow.episodeStates.searching" />, <Ui k="panel.follow.episodeStates.waiting" />, <Ui k="panel.follow.episodeStates.downloading" />, <Ui k="panel.follow.episodeStates.in_library" />, <Ui k="panel.follow.episodeStates.no_space" /> or <Ui k="panel.follow.episodeStates.missing" />. Click an episode to see the releases of the last check: <Ui k="panel.follow.candidates.verdicts.grab" />, <Ui k="panel.follow.candidates.verdicts.pending" /> or <Ui k="panel.follow.candidates.verdicts.rejected" />, with the reason in plain words, such as no Russian audio track, a screen recording, or waiting for your voice-over until a set time.
- **<Ui k="panel.follow.candidates.block" />.** Next to a release in that list that wasn't taken. Torsher never takes it for this title, and it goes to the blocklist.
- **<Ui k="panel.follow.actions.searchNow" />.** Searches your indexers within a minute, outside the hourly limit. The card shows when the last search was and when the next one is due.
- **<Ui k="panel.follow.actions.pause" />** stops searching and downloading but keeps the rules and the profiles. **<Ui k="panel.follow.actions.delete" />** removes the follow and unsubscribes the profiles. In both cases downloaded files stay in the library.

## Activity

<Ui k="panel.follow.activity.title" /> opens from the button at the top of <Ui k="panel.nav.follow" />. Filter it by title and by event.

- **<Ui k="panel.follow.activity.tabs.queue" />.** Releases held back and until when, downloads of followed titles with their progress, and episodes waiting for space.
- **<Ui k="panel.follow.activity.tabs.history" />.** What Torsher found, downloaded, replaced, rejected and searched, for 90 days. A release that looks like the title but isn't certain has two buttons: <Ui k="panel.follow.unsure.confirm" /> remembers its name for this title and passes it to the automation, <Ui k="panel.follow.unsure.dismiss" /> drops it.
- **<Ui k="panel.follow.activity.tabs.blocklist" />.** Releases that stalled (no peers and no progress for 6 hours, kept out for 7 days), releases whose files lack episodes the name promises (when only some are missing, the row lists them, and only those are kept out), and releases you declined. Select <Ui k="panel.follow.blocklist.remove" /> to let one be taken again.

## Settings

<Ui k="panel.nav.settings panel.settings.nav.follow" />:

- **<Ui k="panel.settings.follow.rss.title" />.** Every 15 minutes by default, from 10 to 120 minutes. 0 turns the feed off, and follows find releases by targeted searches only.
- **<Ui k="panel.settings.follow.budget.title" />.** 20 by default, from 1 to 60. Fewer searches are gentler on your indexers.
- **<Ui k="panel.settings.follow.defaults.title" />.** The wait for series (a day by default) and for movies (3 days), the quality, and when a Russian audio track is required: <Ui k="panel.settings.follow.defaults.russian.auto.title" /> (the default), <Ui k="panel.settings.follow.defaults.russian.always.title" /> or <Ui k="panel.settings.follow.defaults.russian.never.title" />. Existing follows keep their rules.

Each indexer's card in <Ui k="panel.nav.sources" /> has a <Ui k="panel.sources.feed.label" /> line: when the feed was last read, and a switch to turn it off for that indexer. For indexers imported from Prowlarr the switch shows <Ui k="panel.sources.feed.managed" />: Torsher reads the feed if Prowlarr says the indexer supports it. An indexer that returns no feed three times in a row is tried again a week later.

## Notifications

Following uses the same notifications as the rest of the server. See [Settings](/docs/panel/settings).

| Notification | Where it goes |
| --- | --- |
| Episodes in the library, one message per title | Channels with the <Ui k="panel.notifications.groups.follow" /> group, and the panel bell |
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
