---
title: Jellyfin-compatible players
description: Connect a Jellyfin-compatible player to your local Torsher library for direct play and shared watch progress.
---

# Jellyfin-compatible players

Torsher provides a Jellyfin-compatible connection for files already in your library. On November 4, 2026, we tested Infuse 8.5.9 and VidHub 3.0.3 on macOS 27.0.1. Both browsed local movies, TV seasons, episodes and home videos. We tested direct play and seeking with H.264/AAC MP4 files, two versions of a movie, per-episode watched marks, and playback positions shared between the two players.

::: tip What you'll get
Browse local movies, episodes and home videos in another player, with watch progress shared with your Torsher profile.
:::

## Before you start

- Add files to your [library](/docs/watch/library), or keep a completed download there. Downloads still in the torrent cache are not included.
- Have the server owner's username and password ready. A profile PIN is not a server password.
- Make sure the player can reach your server and play the original file's video, audio and subtitle formats. This connection does not transcode, convert audio or provide external subtitle conversion.
- Check the profile marked <Ui k="panel.people.profiles.default" /> in <Ui k="panel.nav.people" />. Each new connection uses that profile at the time of sign-in.

## Connect

1. In your player, add a server using its Jellyfin connection option.
2. Enter the Torsher server URL, for example `http://<server-address>:8080`. Use the server's network address, not `localhost`; do not add `/api` or `/panel`.
3. Sign in with the **server owner's username and password**. Use a trusted player and HTTPS for [remote access](/docs/install/remote-access).
4. Open a library and start a movie or episode.

The connection stays attached to that profile. Switching profiles is not available through this connection. Deleting the attached profile ends its access.

## Check

Play a local file, stop partway through, then check its position in Torsher using the same profile. Watch position, watched marks and catalog favorites share Torsher's existing data. Favorites for unmatched files and home videos are not supported.

Movies with several file versions appear as one item. When switching players, check the selected version before resuming. Torsher offers the last played file first, but Infuse can keep its own previous selection. A manual version choice in either player uses the shared watch position. Series include local seasons and episodes. A file containing several episodes appears as an episode range, without separate seek points for each episode.

## Disconnect a player

Open <Ui k="panel.nav.people" /> and disconnect its entry in the device list. Access ends on the next request. Signing out in the player also revokes its token; changing the owner's username or password revokes all these connections.

## If something went wrong

- **Sign-in fails.** Check the owner's credentials and the server URL. A profile name and PIN cannot sign in. After repeated failed attempts, wait for the sign-in limit to expire.
- **A library or file is missing.** Check that its folder is online, the file is present and the library is visible to the connected profile. A cached or incomplete torrent does not appear here.
- **The library opens but playback fails.** The player must support the original format. Try the same file in Torsher's own player, which has separate conversion capabilities.
- **A client feature is missing.** This interface supports local-library browsing, direct play and progress. It does not provide the complete Jellyfin API, live TV, remote control, transcoding or torrent playback before download completion.

Library visibility settings apply to the connected profile. Age limits are not enforced by this interface; do not use it as a parental-control boundary.

The device checks above apply to macOS. iPhone and iPad still need separate testing. Android Jellyfin clients, Swiftfin and Findroid are outside this initial compatibility scope.

## Next

- [Library and home videos](/docs/watch/library).
- [Profiles and devices](/docs/panel/profiles-devices).
- [Other devices](/docs/tv/other-devices).
