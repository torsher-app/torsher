---
title: Follow
description: "Follow a series or a movie on the TV: new episodes download into your library on their own, or Torsher picks a release and notifies you, in your voice-over and the best quality released."
---

# Follow

Follow a series and its new episodes download into your library on their own, in your voice-over and in the best quality released. If you'd rather stream than keep files, Torsher can only pick a release for each new episode and notify you instead. Follow a movie and it downloads, or you get notified, once a proper digital release is out.

Following is about new episodes. Episodes that are already out aren't downloaded: select <Ui k="title.watch" /> to stream them, or download a season from the title page.

::: tip What you'll get
A followed series that fills your library by itself or tells you when an episode is ready, new episodes in <Ui k="home.rows.continue" /> with a bell, its status on the title page, and upcoming and recent episodes in <Ui k="nav.mine mine.sections.schedule" />.
:::

## Before you start

- At least one indexer is connected. See [Indexers](/docs/setup/indexers).
- To download new episodes, the server has room for them. Downloaded episodes are kept in the library, not in the cache. See [Storage](/docs/setup/storage). <Ui k="follow.panel.modes.notify" /> needs no space.

## Follow a title

1. Open a series or a movie on the TV.
2. Select <Ui k="follow.follow" />. Following starts right away with the default rules, and the rules sheet opens.
3. Change a rule if you want, or press Back. Each choice is saved as soon as you pick it.

The button now reads <Ui k="follow.following" />, with the rules in a second line: whether new episodes download or you get notified, the voice-over and the top quality. Select it again to open the rules.

Following is shared by the whole server: one set of rules per title, so a series is never downloaded twice. Every profile that selects <Ui k="follow.follow" /> subscribes to it. Rules are changed by a profile without an age limit and in the panel; a profile with an age limit sees the rules and can only stop following.

## The rules

- **<Ui k="follow.panel.mode" />.** <Ui k="follow.panel.modes.download" /> (the default) or <Ui k="follow.panel.modes.notify" />. See [Download or notify](#download-or-notify). The default for new follows is set in the panel.
- **<Ui k="follow.panel.voice" />.** Which audio to look for. The first choice follows the server's audio language, set in the panel (see [Audio language](#audio-language)). <Ui k="audioLanguages.original" /> takes releases with the original audio track; <Ui k="follow.panel.voiceOtherLanguage" /> picks a language for this title only. For Russian you also pick the voice-over studio of the season, <Ui k="follow.panel.voiceAny" />, or only that studio. If the season has no studio yet, the first episode Torsher takes or your pick on the <Ui k="sources.title" /> screen sets it, and the next episodes keep it.
- **<Ui k="follow.panel.wait" />.** <Ui k="follow.panel.waitNone" />, 12 hours, a day or 3 days. The wait starts when an episode first appears. During it, Torsher holds back releases in another voice-over or a lower quality; a release in your voice-over and top quality is taken at once. When the wait is over, the best release so far is taken.
- **<Ui k="follow.panel.quality" />.** The top quality to wait for: <Ui k="follow.panel.qualities.best" /> (then 720p and SD), <Ui k="follow.panel.qualities.uhd" /> (then 1080p and 720p) or <Ui k="follow.panel.qualities.compact" /> (then SD). If a show never comes out in the top quality, Torsher stops waiting for it.
- **<Ui k="follow.panel.stop" />.** Unsubscribes only your profile: other profiles that follow the title keep following it. When the last profile stops, nothing new is searched or downloaded. Downloaded episodes stay in the library.

Whether a Russian audio track is required is set in the panel. See [Following](/docs/panel/follow).

### Audio language {#audio-language}

Torsher reads the audio language from tags in the release name.

- **<Ui k="audioLanguages.original" />.** A release with the original audio track is taken, and so is a release whose name lists no audio at all: English-language indexers rarely write it. A release with only dubs in other languages is not taken. Torsher doesn't wait for a voice-over, only for the quality.
- **Russian.** Voice-over studios and translation types, as described above.
- **Another language** (German, French and others the release names tag). A release with an audio track in that language is taken at once. Without one, Torsher waits until <Ui k="follow.panel.wait" /> runs out, then takes the original, not a dub in another language. If the title's original language is the one you picked, a release that fits as the original is taken too; a release with only a dub in another language still isn't.

The server's audio language applies to every follow without its own choice. Until you set it, Torsher picks it from the language of the first browser or TV that connects: Russian for Russian, a language from the list above for that language, the original for English and any other. English itself is only a manual choice: with it, an anime or a K-drama would wait out the window for an English-tagged release. A choice you make in the setup wizard, in the panel or on a follow is never changed by that guess.

Following starts from the first episode that hasn't aired yet and includes every season after it.

## Download or notify {#download-or-notify}

Both modes find releases the same way and follow the same rules. They differ in what happens when Torsher takes a release.

| | <Ui k="follow.panel.modes.download" /> | <Ui k="follow.panel.modes.notify" /> |
| --- | --- | --- |
| The episode | Downloads into your library | Gets a picked release and becomes <Ui k="follow.episode.ready" />; nothing is downloaded |
| Notification | The episode is in the library | The episode is ready to watch |
| <Ui k="title.watch" /> | Plays the file from the library | Streams the picked release right away, without the release list |
| A better release later | Replaces the file | Replaces the picked release |

Both notifications go to the panel bell and to your channels with the following group turned on. See [Following in the panel](/docs/panel/follow#notifications).

If the picked release is gone by the time you watch, Torsher picks another one for you, the same way as for any episode, and looks for a new release for the follow.

Switching from <Ui k="follow.panel.modes.download" /> to <Ui k="follow.panel.modes.notify" /> keeps what is downloaded, and downloads already started finish. Switching back downloads the episodes that are ready, without a new search.

## What happens next

- **Finding releases.** Torsher reads the feed of new releases from your indexers every 15 minutes and searches by every name of the title when it needs to: right after you follow, when an episode airs, and on a schedule after that. It takes only releases it is sure are this title.
- **Only the episodes you need.** From a season pack, only the missing episodes download.
- **A release that grows.** When a release that adds episodes over the season gets a new version, Torsher switches to it and downloads only the new episodes. Watched episodes keep their position.
- **A better version.** If an episode came in another voice-over or a lower quality, Torsher replaces it, or the picked release, when a release closer to your rules appears, within 7 days and only while nobody has started watching it. An episode you picked or downloaded yourself is never replaced.
- **Episodes ahead of the catalog.** When releases have episodes that TMDB doesn't list yet, they show up as aired and download like the others.
- **Movies.** A followed movie is taken once it is out digitally or on disc. Screen recordings are never taken. It waits 3 days for a better voice-over by default, and a better version replaces it within 60 days while nobody has watched it.

Want to watch an episode before Torsher takes it? <Ui k="title.watch" /> streams it right away, as always.

## Check

- A new episode you haven't watched yet shows up first in <Ui k="home.rows.continue" /> on the home screen, with a bell and <Ui k="follow.newEpisode" />. Select it to start watching. If you remove the card from the row, it comes back with the next new episode.
- The line under the buttons on the title page shows what Torsher is doing and names the episode by its code, such as S2E6: an episode that is out and being searched for, an episode ready to watch, the next episode and its date, what is downloading from which episode on, or what release an episode is waiting for and until when.
- Episodes on the title page show their state: <Ui k="follow.episode.in_library" />, <Ui k="follow.episode.ready" />, <Ui k="follow.episode.downloading" />, <Ui k="follow.episode.searching" />, <Ui k="follow.episode.waitingBetter" />, <Ui k="follow.episode.no_space" /> or <Ui k="follow.episode.missing" />.
- Posters of followed titles have a bell badge, with the number of new episodes downloaded or ready and not watched yet.
- <Ui k="nav.mine mine.sections.schedule" /> lists the episodes of the series you follow or watch: <Ui k="mine.schedule.upcoming" /> by day for the next 30 days and <Ui k="mine.schedule.recent" /> for the last 14. Select an episode in the library to play it, an aired one to start watching, or a future one to open the series.

## If something went wrong

- **<Ui k="follow.episode.searching" /> for a long time.** No release of the episode has appeared in your indexers yet. Check that your indexers answer in <Ui k="panel.nav.sources" /> in the panel. After a while without releases the episode becomes <Ui k="follow.episode.missing" />, and new releases still pick it up.
- **<Ui k="follow.episode.no_space" />.** The release doesn't fit on the disk. Free up space or raise the limits in <Ui k="panel.nav.settings panel.settings.nav.storage" />: the download starts by itself.
- **The wrong voice-over.** Your voice-over didn't come out within the wait. Torsher will replace the episode if it comes out, unless someone has started watching it.
- **Older episodes didn't download.** Following takes only episodes that air after you follow. Download a season from the title page, or stream an episode with <Ui k="title.watch" />.
- **Not sure what happened.** <Ui k="panel.nav.follow" /> in the panel shows every release found for an episode and why it was rejected.

## Next

[Following in the panel](/docs/panel/follow): rules, found releases, history and notifications.
