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

1. Open a series or a movie in the showcase, on the TV or in a browser. From the panel’s <Ui k="panel.nav.follow" /> page, select <Ui k="panel.follow.chooseInShowcase" /> to open it.
2. Select <Ui k="follow.follow" />. Your profile subscribes and the rules sheet opens. A new follow starts with the default rules; an existing follow keeps its shared rules.
3. Change a rule if you want, or press Back. The sheet explains that rules apply to all subscribed profiles. Each choice is saved as soon as you pick it.

The button now reads <Ui k="follow.following" />, with the rules in a second line: whether new episodes download or you get notified, the voice-over and the top quality. Select it again to open the rules.

Following is shared by the whole server: one set of rules per title, so a series is never downloaded twice. Every profile that selects <Ui k="follow.follow" /> subscribes to it. Rules are changed by a profile without an age limit and in the panel; a profile with an age limit sees the rules and can only stop following.

If the owner has paused the follow, you still subscribe, but automation stays paused. A message confirms both facts, and the title’s status continues to show the pause. The owner can resume it in the panel.

The waiting status identifies the episode, the release quality and audio found so far, what is still preferred, and when the wait ends. Unknown release details are omitted. The same details appear on an episode while it waits.

## The rules

- **<Ui k="follow.panel.mode" />.** <Ui k="follow.panel.modes.download" /> (the default) or <Ui k="follow.panel.modes.notify" />. See [Download or notify](#download-or-notify). The default for new follows is set in the panel.
- **<Ui k="follow.panel.voice" />.** Which audio to look for. The first choice follows the default source preset's ordered audio preferences (see [Audio language](#audio-language)). <Ui k="audioLanguages.original" /> takes releases with the original audio track; <Ui k="follow.panel.voiceOtherLanguage" /> picks a language for this title only. For Russian, a separate <Ui k="follow.studio.title" /> rule controls the voice-over studio. See [Studio](#studio).
- **<Ui k="follow.panel.wait" />.** <Ui k="follow.panel.waitNone" />, 12 hours, a day or 3 days. The wait starts when an episode first appears. During it, Torsher holds back releases in another voice-over or a lower quality; a release in your voice-over and top quality is taken at once. When the wait is over, the best allowed release so far is taken. <Ui k="follow.studio.only" /> never falls back to another studio; <Ui k="follow.studio.any" /> does not wait for a studio or translation type; language and quality rules still apply.
- **<Ui k="follow.panel.quality" />.** The top quality to wait for: <Ui k="follow.panel.qualities.best" /> (then 720p and SD), <Ui k="follow.panel.qualities.uhd" /> (then 1080p and 720p) or <Ui k="follow.panel.qualities.compact" /> (then SD). If a show never comes out in the top quality, Torsher stops waiting for it.
- **<Ui k="follow.panel.stop" />.** Unsubscribes only your profile: other profiles that follow the title keep following it. When the last profile stops, nothing new is searched or downloaded. Downloaded episodes stay in the library.

Whether a Russian audio track is required is set in the panel. See [Following](/docs/panel/follow).

The owner can also configure optional [automatic cleanup of watched downloads](/docs/panel/follow#library-maintenance) in the panel. It is off by default, waits for the selected profiles to finish watching and can protect the latest episodes. A new follow on the TV inherits an enabled default rule. The owner can exclude it in the panel.

Following uses the Russian voice-type order of the server default preset, which can be changed in <Ui k="panel.nav.settings panel.settings.nav.sources" />. An explicit preferred or required studio takes priority over season pins. <Ui k="follow.studio.any" /> ignores both studio pins and Russian translation-type priorities. Each follow keeps its own quality rule, even when the source quality order changes. Presets selected by viewers in the showcase do not change these rules. See [Source preferences](/docs/watch/sources#set-source-preferences).

### Audio language {#audio-language}

Torsher reads language and translation-type tags from the release name. Without an explicit rule on the follow, it uses the default source preset's ordered languages and translation types. A viewer choosing a different preset does not change automation.

The first language is preferred; lower languages in the preset can be taken after the waiting window. Translation types are compared within the same language. Original matches the title's original language and retains the fallback for releases that name no audio tracks. Unlisted languages are not selected automatically.

An explicit language on a follow overrides the preset's language list. Existing single-language rules keep their original-audio fallback after the waiting window. Russian studio pins and the explicit rule requiring a Russian track are preserved. Quality still follows each follow's own quality rule.

Following starts from the first episode that hasn't aired yet and includes every season after it.

### Studio {#studio}

For Russian audio, open <Ui k="follow.studio.title" /> and choose:

- **<Ui k="follow.studio.auto" />.** Keep the season's studio, inherit it from an earlier season, or use the server's source preferences until the first release establishes a studio.
- **<Ui k="follow.studio.prefer" />.** Prefer the studio you select. Another studio can be taken after the waiting window.
- **<Ui k="follow.studio.only" />.** Take releases containing the selected studio. If none appears, keep searching, even after the waiting window.
- **<Ui k="follow.studio.any" />.** Accept any studio and Russian translation type. Language and quality rules still apply.

The first list shows saved and found studios. Open <Ui k="follow.studio.otherGroup" /> to browse every known studio, including ones outside the season’s results. All rows are accessible with the remote; the search field is optional and uses your device’s keyboard. Search names or aliases, and explicitly select a suggested studio. Back from the input returns to the list; Back from the list returns to the previous step without saving. In the panel, use the searchable studio field and then <Ui k="panel.follow.rules.save" />. Typing a query never saves it or searches the indexers.

<Ui k="follow.studio.refresh" /> explicitly refreshes season results. A found studio means it is listed in release titles in the cached results for that season, not that every release fits the rules or contains a verified audio track. The count is releases, not suitable episodes; the update time describes the combined results. <Ui k="follow.studio.saved" /> marks the saved explicit rule independently of whether it was found. A resolved or inherited studio is not a saved explicit choice.

Empty, stale or incomplete results do not prove a studio is unavailable. A saved choice survives an empty refresh or a search error. You may choose a known studio outside the results: <Ui k="follow.studio.only" /> waits for it, while <Ui k="follow.studio.prefer" /> allows another suitable release after the waiting window. Unknown names cannot be added through this field; old unknown rules remain unchanged until you replace them.

The rule applies to the whole follow, including later seasons. The season shown in the list only gives context for finding studios. Changing to another audio language preserves the studio rule but makes it inactive until Russian is selected again. A studio rule selects a release; it does not change the player's saved audio-track choice inside a release with several tracks.

Existing follows show <Ui k="follow.studio.legacy" /> and keep their previous behavior until you choose a mode. Changing another rule does not convert them.

## Download or notify {#download-or-notify}

Both modes find releases the same way and follow the same rules. They differ in what happens when Torsher takes a release.

| | <Ui k="follow.panel.modes.download" /> | <Ui k="follow.panel.modes.notify" /> |
| --- | --- | --- |
| The episode | Downloads into your library | Gets a picked release and becomes <Ui k="follow.episode.ready" />; nothing is downloaded |
| Notification | The episode is in the library | The episode is ready to watch |
| <Ui k="title.watch" /> | Plays the file from the library | Streams the picked release right away, without the release list |
| A better release later | Replaces the file | Replaces the picked release |

Both notifications go to the panel bell and to your channels with the following group turned on. See [Following in the panel](/docs/panel/follow#notifications).

If a ready release no longer fits the follow rules, opening it stops and refreshes its status. Torsher looks for another release under the current rules. It does not silently start a different release from that ready action; you can still choose a release yourself on the sources screen.

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

- A title with a new episode appears first in <Ui k="home.rows.continue" />, with a bell. If you have watched it in Torsher, the card resumes your unfinished episode or the next unwatched episode in order. The bell reports an update; it does not skip intervening episodes. Without playback history, it opens the new episode. If you remove the card, it comes back with the next update.
- The line under the buttons on the title page shows what Torsher is doing and names the episode by its code, such as S2E6: an episode that is out and being searched for, an episode ready to watch, the next episode and its date, what is downloading from which episode on, or what release an episode is waiting for and until when.
- Episodes on the title page show their state: <Ui k="follow.episode.in_library" />, <Ui k="follow.episode.ready" />, <Ui k="follow.episode.downloading" />, <Ui k="follow.episode.searching" />, <Ui k="follow.episode.waitingBetter" />, <Ui k="follow.episode.no_space" /> or <Ui k="follow.episode.missing" />.
- Posters of followed titles have a bell badge, with the number of new episodes downloaded or ready and not watched yet.
- <Ui k="nav.mine mine.sections.schedule" /> lists the episodes of the series you follow or watch: <Ui k="mine.schedule.upcoming" /> by day for the next 30 days and <Ui k="mine.schedule.recent" /> for the last 14. Select an episode in the library to play it, an aired one to start watching, or a future one to open the series.

## If something went wrong

- **<Ui k="follow.episode.searching" /> for a long time.** No release of the episode has appeared in your indexers yet. Check that your indexers answer in <Ui k="panel.nav.sources" /> in the panel. After a while without releases the episode becomes <Ui k="follow.episode.missing" />, and new releases still pick it up.
- **<Ui k="follow.episode.no_space" />.** The release doesn't fit on the disk. Free up space or raise the limits in <Ui k="panel.nav.settings panel.settings.nav.storage" />: the download starts by itself.
- **The wrong voice-over.** With <Ui k="follow.studio.auto" /> or <Ui k="follow.studio.prefer" />, another studio can be taken after the wait. Use <Ui k="follow.studio.only" /> to prevent that fallback. For a release with several audio tracks, also check the player's selected track. Changing follow rules does not replace episodes that someone has already started watching, manual choices or downloads already underway.
- **Older episodes didn't download.** Following takes only episodes that air after you follow. Download a season from the title page, or stream an episode with <Ui k="title.watch" />.
- **Not sure what happened.** <Ui k="panel.nav.follow" /> in the panel shows every release found for an episode and why it was rejected.

## Next

[Following in the panel](/docs/panel/follow): rules, found releases, history and notifications.
