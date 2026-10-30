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
- **The lamp lights up and grows brighter**: data is coming. The status reads <Ui k="player.steps.buffering" /> with the percentage and speed. Moths gather around the lamp, one for each connected peer.

If the video starts quickly, you don't see the lamp at all.

If the stream breaks off or stalls, the player reconnects by itself and continues from the same place. It shows <Ui k="player.steps.reconnecting" /> and keeps trying for up to 3 minutes before it shows an error. <Ui k="player.steps.slow" /> means peers are there but the video doesn't move: you can wait or pick another release.

## Continue and start over

The player continues from your last position, by episode rather than by file: you continue even after switching to another release. If you stopped in the first 5% or after 90%, it starts from the beginning.

When it continues, <Ui k="player.fromStart" /> appears first among the buttons. Press down to reach it.

## Keys

| Key | Controls hidden | On the timeline |
|---|---|---|
| **OK** | Pause or play | Pause or play |
| Left, right | Seek 10 seconds | Seek 10 seconds |
| Down | Show the controls | Go to the buttons |
| **Back** | Exit the player | Hide the controls |

Hold left or right to seek faster: the step grows to 30 seconds, a minute and 2 minutes. Presses add up, and the player jumps once you stop. Play, Pause, rewind and forward on the remote work while no panel is open; Stop exits.

Back closes an open panel first, then hides the controls, then exits. Your position is saved every 10 seconds, on pause and when you leave.

The controls hide after 4 seconds of playback. They show the title and the file name, the clock, peers, speed and how much is buffered, the time left and when the video ends. Paused for 10 seconds, the picture dims and shows <Ui k="player.youAreWatching" /> with the episode description. The first key press brings the controls back.

With a pointer or a mouse, moving shows the controls, a click on the picture pauses, and a click on the timeline jumps there.

## Audio

<Ui k="player.audio" /> appears when the file has two or more audio tracks. Its second line is the voice-over or language that's playing. The panel lists each track by language and studio, with its type, codec and channels.

The player picks the track itself: the voice-over of the release you chose or of your last episodes, otherwise one in your profile language. The track you pick is remembered for the next episodes.

Some devices can't switch tracks inside a file. Then the panel says so, and the stream restarts from the same point with the new track.

## Subtitles

<Ui k="player.subtitles" /> appears when the file or the release has subtitles: tracks inside the video, separate files next to it (marked <Ui k="player.subtitleFile" />) and image subtitles from discs (marked <Ui k="player.subtitleBurnIn" />). Every video starts with subtitles <Ui k="player.subtitlesOff" />.

Image subtitles can't be drawn as text: the server burns them into the picture, so turning them on or off restarts the stream from the same point and needs transcoding.

The size and the background of subtitles are in <Ui k="player.settings.button" />. They belong to your profile.

## Episodes

<Ui k="player.episodes.button" /> lists the aired episodes of a season, with season chips on top. Each episode shows its progress: <Ui k="player.episodes.current" />, <Ui k="player.episodes.watched" />, the time left, and <Ui k="player.episodes.inTorrent" /> when this release has it.

An episode from this release starts at once. For another one, Torsher looks for it in the releases you watched and then in the search results, with your voice-over first. The screen says <Ui k="resolve.searching" /> meanwhile.

## Switch the release

<Ui k="player.source.button" /> opens the same <Ui k="sources.title" /> screen as on the title page, over the paused video, with only the releases that have this episode. The release that's playing is marked <Ui k="player.source.current" />. See [Sources and audio](/docs/watch/sources).

Pick another release and the player continues from the same position, with the voice-over you were hearing if the new release has it. Back returns to the video without changes.

## Next episode

Thirty seconds before the end of an episode, a card shows the next one with a countdown. When it reaches zero or the episode ends, the next episode starts.

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
