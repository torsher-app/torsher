---
title: Player
description: "Play, pause and switch tracks: audio and subtitles, episodes, another release, the next episode, the buffering lamp and the video link for other players."
---

# Player

The player starts from the file list, from <Ui k="title.resume" /> on a title page or from <Ui k="home.rows.continue" /> on home. It continues where you left off, switches audio, subtitles, episodes and releases without leaving, and moves on to the next episode by itself.

::: tip What you'll learn
The keys of the player, how to change the voice-over and subtitles, switch to another release, and what the lamp on the waiting screen tells you.
:::

## While it starts

Before the video starts, the screen shows the title's backdrop, its name, the episode and a floor lamp. The lamp tells you whether data is coming:

- **The cord is pulled but the lamp barely flickers**: no peers yet. The status reads <Ui k="player.steps.connecting" /> and how many peers were found. After 15 seconds without peers it reads <Ui k="player.steps.waitingPeers" />: <Ui k="player.waitingHint" />
- **The lamp lights up and grows brighter**: data is coming. The status reads <Ui k="player.steps.buffering" /> with the preparation percentage, the server's download speed in Mbps and connected seeders beside an up arrow. Moths gather around the lamp, one for each connected peer, including peers that are still downloading.

If the video starts quickly, you don't see the lamp at all.

If the stream breaks off or stalls, the player reconnects by itself and continues from the same place. It shows <Ui k="player.steps.reconnecting" /> while retrying, then an error if it cannot recover. Back remains available while you wait. <Ui k="player.steps.slow" /> means peers are there but the video doesn't move: you can wait or pick another release.

## Continue and start over

The player continues from your last position, by episode rather than by file: you continue even after switching to another release. If you stopped in the first 5% or after 90%, it starts from the beginning.

When it continues, <Ui k="player.fromStart" /> appears first among the buttons. Press down to reach it.

When automatically opening another episode, Torsher prefers a source you watched for at least 5% of its duration or marked watched with a saved source. A brief opening does not replace that preference. Resuming an unfinished episode keeps its own file.

If the prepared episode has a confirmed lower resolution than the previous viewing, the player asks before starting. You can accept that resolution, select <Ui k="player.quality.sources" />, or go back. This compares the original files, not transcoded output. It needs a current probe of both files; if the earlier probe is unavailable, there is no warning. An explicit source or version choice plays without this extra confirmation.

## Keys

| Key | Controls hidden | On the timeline |
|---|---|---|
| **OK** | Pause or play | Pause or play |
| Left, right | Seek 10 seconds | Seek 10 seconds |
| Down | Show the controls | Go to the buttons |
| **Back** | Exit the player | Hide the controls |

Hold left or right to seek faster: the step grows to 30 seconds, a minute and 2 minutes. Presses add up, and the player jumps once you stop. Play, Pause, rewind and forward on the remote work while no panel is open; Stop exits.

Back closes an open panel first, then hides the controls, then exits. Your position is saved every 10 seconds, on pause and when you leave.

If pointer movement brings the controls back after you hide them with Back, the next Back still exits. Clicking or pressing another key starts this sequence over.

The controls hide after 4 seconds of playback. They show the title and the file name, the clock, download statistics, the time left and when the video ends. Paused for 10 seconds, the picture dims and shows <Ui k="player.youAreWatching" /> with the episode description. The first key press brings the controls back.

For a streaming torrent, the chip beside the clock shows the server's download speed in Mbps, <Ui k="player.stats.player" /> for video buffered by your player, <Ui k="player.stats.cache" /> for video cached on the server, and connected seeders beside an up arrow. The timeline shows the player's buffer. A cache value prefixed with ≥ is a confirmed minimum; the actual cached time can be longer. A dash means the server cannot confirm it yet, for example when a file has no usable time index. This seeder count can differ from the count in the source list: only currently connected seeders are shown here. The speed measures the server's torrent download, not the connection from the server to your TV.

The bars compare download speed with the video's average bitrate. Dim bars do not mean playback has failed. With at least a minute in the player or confirmed server cache, the chip stays neutral. Otherwise, stalled playback and download speed below the average bitrate trigger a warning. When all remaining source bytes are verified, the chip shows <Ui k="player.downloaded" />. Library videos have no torrent chip; unavailable or stale statistics are hidden.

With a pointer or a mouse, moving shows the controls, a click on the picture pauses, and a click on the timeline jumps there.

## Skip intros and credits

For analyzed videos in your library, <Ui k="player.skipIntro" /> or <Ui k="player.skipCredits" /> appears during a detected section. With the controls hidden, press **OK** to skip or **Back** to dismiss it. With the controls visible, choose the skip button. Skipping keeps the video paused if you paused it, and never happens automatically.

After you add videos to your library, you may notice higher CPU usage on the server while nobody is watching. Torsher uses FFmpeg to look for intros and credits in the background. It pauses this work when playback starts and tries again once nobody is watching. The skip button uses the timestamps saved by that analysis. Pressing it simply seeks to the end of the detected section.

New files may need some idle time before a button appears. Intro detection needs at least three different episodes from the same season in your library. Credits detection supports light text on a dark background. Streamed torrents, unsupported credits and uncertain matches show no button. Conservative boundaries can leave a short part of the section to play.

Skipping credits seeks only across a confirmed section, preserving gaps that may contain scenes. The usual next-episode setting still applies.

## Audio

<Ui k="player.audio" /> appears when the file has two or more audio tracks. Its second line is the voice-over or language that's playing. The panel lists each track by language and studio, with its type, codec and channels.

Your explicit audio choice is saved on the server for this title in your profile. It applies to the next episodes and later visits, using the language, studio and translation type rather than a track number. Without an explicit choice, the player uses the release or episode history, then your profile language. Choosing a track does not change Following rules.

Some devices can't switch tracks inside a file, so the stream restarts from the same point with the new track. If paused, it stays paused. If a preferred track cannot be identified in the new file, a notice explains that it is unavailable; your preference is kept for later files.

## Subtitles

<Ui k="player.subtitles" /> appears when the file or the release has subtitles: tracks inside the video, separate files next to it (marked <Ui k="player.subtitleFile" />) and image subtitles from discs (marked <Ui k="player.subtitleBurnIn" />). Without a saved choice, subtitles start <Ui k="player.subtitlesOff" />. Choosing a language or explicitly selecting <Ui k="player.subtitlesOff" /> saves that choice for this title in your profile, including later episodes and app restarts. Full and forced subtitles are matched separately. For home videos without a catalog title, track choices belong to that file.

Image subtitles can't be drawn as text: the server burns them into the picture, so turning them on or off restarts the stream from the same point and needs transcoding.

The size and the background of subtitles are in <Ui k="player.settings.button" />. They belong to your profile.

## Episodes

You can also start a specific episode from the title page: press OK on it, then select <Ui k="title.watch" />, <Ui k="title.resume" /> or <Ui k="player.fromStart" />. See [Episode actions](/docs/watch/showcase#episode-actions).

<Ui k="player.episodes.button" /> lists the aired episodes of a season, with season chips on top. Each episode shows its progress: <Ui k="player.episodes.current" />, <Ui k="player.episodes.watched" />, the time left, and <Ui k="player.episodes.inTorrent" /> when this release has it.

Switching episodes keeps the current release when it contains the episode, even if you watched that episode from another release before. Your explicit audio and subtitle preferences take priority over the episode's old choice. This applies to the next episode too; you do not need to watch a minimum amount first.

If the episode is missing from the current release, Torsher checks your viewing history, the release picked by Following, and then search results. The screen says <Ui k="resolve.searching" /> meanwhile. If the audio check cannot confirm the same studio in the selected track, a message asks you to check the audio track. Files without audio metadata cannot be checked this way.

## Switch the release

<Ui k="player.source.button" /> opens the same <Ui k="sources.title" /> screen as on the title page, over the paused video, with only the releases that have this episode. The release that's playing is marked <Ui k="player.source.current" />. See [Sources and audio](/docs/watch/sources).

Pick another release and the player continues from the same position, with the voice-over you were hearing if the new release has it. Back returns to the video without changes. If you already selected a release and it is still connecting, Back restores the previous file at the same position and keeps it paused.

## Next episode

The next-episode card appears during detected credits or in the last 60 seconds. The countdown appears only in the last 30 seconds. Automatic playback starts at the end of the file; showing the card early does not skip the ending. After a detected credits section ends, the early card disappears until the last minute.

- **OK** starts it right away, while the controls are hidden.
- **Back** cancels it until the end of this episode.

With <Ui k="player.settings.autoNext" /> off, the episode ends paused with the card on screen. The setting is in <Ui k="player.settings.button" /> and belongs to your profile; it's on by default.

## Settings

<Ui k="player.settings.button" /> is the round button at the right end of the row:

- **<Ui k="player.settings.speed" />**: from 0.5× to 2×. It applies until the app is restarted.
- **<Ui k="player.settings.subtitleSize" />** and **<Ui k="player.settings.subtitleBackground" />**.
- **<Ui k="player.settings.autoNext" />**.
- **<Ui k="player.settings.link" />**: see below.

## Watch in another player

<Ui k="player.settings.link" /> shows a direct link to the original file. Open it in another player, such as VLC on a computer or a phone in the same network. The link works for 12 hours. OK copies it to the clipboard when the device allows it.

The link plays the file as it is: without transcoding, with the original tracks.

## What gets transcoded

Each time a video starts, the server compares the file with what this device can play:

- **The device plays it all**: the file goes as it is.
- **The device plays the video but not the container, the audio or the subtitle format**: the server repackages the file on the fly. The picture is untouched, so this costs almost no CPU.
- **The device can't decode the video**, or image subtitles are on: the server transcodes the video to H.264. This is the heavy case, and a GPU helps a lot. See [Hardware transcoding](/docs/install/hardware-acceleration).

For example, an LG TV plays MKV with HEVC and AC3 itself, while old AVI files with Xvid video are transcoded.

## If something went wrong

- **<Ui k="player.steps.waitingPeers" />** for a long time. See [Playback waits for peers](/docs/troubleshooting#waiting-for-peers).
- **<Ui k="player.errors.notReady.title" />.** See [The torrent isn't ready or has no file list](/docs/troubleshooting#no-file-list).
- **<Ui k="player.errors.unsupported.title" />.** See [The video doesn't play](/docs/troubleshooting#unsupported).
- **<Ui k="player.errors.storage.no_space.title" />.** See [Not enough free space](/docs/troubleshooting#low-space).
- **<Ui k="player.errors.storage.cache_limit.title" />.** See [The file doesn't fit in the cache](/docs/troubleshooting#cache-limit).
- **<Ui k="player.errors.engine.stopped.title" />.** See [The torrent engine isn't running](/docs/troubleshooting#engine).
- **<Ui k="player.errors.unauthorized.title" />.** See [A device says it is not connected](/docs/troubleshooting#not-connected).
- **<Ui k="player.errors.unknown.title" />.** Select <Ui k="player.retry" />: the player continues from the same place.

## Next

[Download and keep](/docs/watch/download-keep): what happens to what you watch.
