---
title: Follow
description: "Follow a series or a movie on the TV: new episodes download into your library on their own, in your voice-over and the best quality released."
---

# Follow

Follow a series and new episodes download into your library on their own: from the episode you choose, in your voice-over and in the best quality released. Follow a movie and it downloads once a proper digital release is out.

::: tip What you'll get
A followed series that fills your library by itself, its status on the title page, and upcoming and recent episodes in <Ui k="nav.mine mine.sections.schedule" />.
:::

## Before you start

- At least one indexer is connected. See [Indexers](/docs/setup/indexers).
- The server has room for downloads. Followed episodes are kept in the library, not in the cache. See [Storage](/docs/setup/storage).

## Follow a title

1. Open a series or a movie on the TV.
2. Select <Ui k="follow.follow" />. Following starts right away with the default rules, and the rules sheet opens.
3. Change a rule if you want, or press Back. Each choice is saved as soon as you pick it.

The button now reads <Ui k="follow.following" />, with the rules in a second line: from which episode, the voice-over and the top quality. Select it again to open the rules.

Following is shared by the whole server: one set of rules per title, so a series is never downloaded twice. Every profile that selects <Ui k="follow.follow" /> subscribes to it. Rules are changed by a profile without an age limit and in the panel; a profile with an age limit sees the rules and can only stop following.

## The rules

- **<Ui k="follow.panel.start" />.** <Ui k="follow.panel.starts.new" />, <Ui k="follow.panel.starts.season" /> or <Ui k="follow.panel.starts.beginning" />. Episodes before it are not downloaded; future seasons are always included. By default, Torsher continues from the next episode you haven't watched; if you haven't watched the series, it starts from the first episode of a season that is airing, or takes only new episodes. An episode you already watched by streaming still downloads: following builds your library, not a queue. Movies don't have this rule.
- **<Ui k="follow.panel.voice" />.** The voice-over studio of the season, <Ui k="follow.panel.voiceAny" />, or only that studio. If the season has no studio yet, the first downloaded episode or your pick on the <Ui k="sources.title" /> screen sets it, and the next episodes keep it.
- **<Ui k="follow.panel.wait" />.** <Ui k="follow.panel.waitNone" />, 12 hours, a day or 3 days. The wait starts when an episode first appears. During it, Torsher holds back releases in another voice-over or a lower quality; a release in your voice-over and top quality downloads at once. When the wait is over, the best release so far downloads.
- **<Ui k="follow.panel.quality" />.** <Ui k="follow.panel.qualities.best" /> (1080p, then 720p, then SD), <Ui k="follow.panel.qualities.uhd" /> (2160p, then 1080p and 720p) or <Ui k="follow.panel.qualities.compact" /> (720p, then SD). If a show never comes out in the top quality, Torsher stops waiting for it.
- **<Ui k="follow.panel.stop" />.** Unsubscribes your profile. When the last profile stops, nothing new is searched or downloaded. Downloaded episodes stay in the library.

Whether a Russian audio track is required is set in the panel. See [Following](/docs/panel/follow).

## What happens next

- **Finding releases.** Torsher reads the feed of new releases from your indexers every 15 minutes and searches by every name of the title when it needs to: right after you follow, when an episode airs, and on a schedule after that. It takes only releases it is sure are this title.
- **Only the episodes you need.** From a season pack, only the missing episodes download.
- **A release that grows.** When a release that adds episodes over the season gets a new version, Torsher switches to it and downloads only the new episodes. Watched episodes keep their position.
- **A better version.** If an episode came in another voice-over or a lower quality, Torsher replaces it when a release closer to your rules appears, within 7 days and only while nobody has started watching it. An episode you picked or downloaded yourself is never replaced.
- **Episodes ahead of the catalog.** When releases have episodes that TMDB doesn't list yet, they show up as aired and download like the others.
- **Movies.** A followed movie downloads once it is out digitally or on disc. Screen recordings are never taken. It waits 3 days for a better voice-over by default, and a better version replaces it within 60 days while nobody has watched it.

Want to watch an episode before it downloads? <Ui k="title.watch" /> streams it right away, as always.

## Check

- The line under the buttons on the title page shows what Torsher is doing, for example the next episode and its date, how many episodes are downloading, or what release it is waiting for and until when.
- Episodes on the title page show their state: <Ui k="follow.episode.in_library" />, <Ui k="follow.episode.downloading" />, <Ui k="follow.episode.searching" />, <Ui k="follow.episode.waitingBetter" />, <Ui k="follow.episode.no_space" /> or <Ui k="follow.episode.missing" />.
- Posters of followed titles have a bell badge, with the number of new episodes downloaded and not watched yet.
- <Ui k="nav.mine mine.sections.schedule" /> lists the episodes of the series you follow or watch: <Ui k="mine.schedule.upcoming" /> by day for the next 30 days and <Ui k="mine.schedule.recent" /> for the last 14. Select an episode in the library to play it, an aired one to start watching, or a future one to open the series.

## If something went wrong

- **<Ui k="follow.episode.searching" /> for a long time.** No release of the episode has appeared in your indexers yet. Check that your indexers answer in <Ui k="panel.nav.sources" /> in the panel. After a while without releases the episode becomes <Ui k="follow.episode.missing" />, and new releases still pick it up.
- **<Ui k="follow.episode.no_space" />.** The release doesn't fit on the disk. Free up space or raise the limits in <Ui k="panel.nav.settings panel.settings.nav.storage" />: the download starts by itself.
- **The wrong voice-over.** Your voice-over didn't come out within the wait. Torsher will replace the episode if it comes out, unless someone has started watching it.
- **Not sure what happened.** <Ui k="panel.nav.follow" /> in the panel shows every release found for an episode and why it was rejected.

## Next

[Following in the panel](/docs/panel/follow): rules, found releases, history and notifications.
