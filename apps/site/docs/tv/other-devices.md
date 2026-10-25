---
title: Other devices
description: "Which devices Torsher works on today, which are planned, and how to watch on other devices in the meantime: a browser or the video link for VLC and Infuse."
---

# Other devices

Torsher has two clients today: the app for LG TVs and the showcase in a browser. Apps for other platforms are planned but not available yet. This page lists what works now and how to watch on other devices in the meantime.

::: tip What you'll learn
Whether your device can run Torsher today, and how to play a video on it if it can't.
:::

## Works today

| Client | Status |
| --- | --- |
| [LG webOS app](/docs/tv/lg-webos) | Tested on LG C4 (2024). TVs from 2020 (webOS 5) and later are targeted, but not tested yet |
| [Browser](/docs/tv/browser) on a computer, a TV or a phone | Developed and checked in Chrome; other current browsers are expected to work |

## Planned

These are not available yet, and there are no dates:

- **Android TV and Google TV:** a Torsher app.
- **Apple TV, iPhone, iPad and Android phones:** through apps that already work with Jellyfin servers, once Torsher can talk to them as a Jellyfin-compatible server.
- **Samsung TVs (Tizen):** later.

Follow the [releases on GitHub](https://github.com/torsher-app/torsher/releases) to see when one of them arrives.

## Until then

### Open the showcase in the device's browser

If the device has a browser, open `http://<server-address>:8080/` in it and connect it with a code. See [Browser](/docs/tv/browser).

### Play the video in another player

The Torsher player can give you a link to the file it is playing. Players such as VLC and Infuse open it as a network stream.

1. Start playing the movie or episode in the showcase, best in a browser on a computer, where you can copy text.
2. Open <Ui k="player.settings.button" /> in the player, then <Ui k="player.settings.link" />.
3. Select the link to copy it. The player shows <Ui k="player.settings.copied" />.
4. Open the link as a network stream in VLC, Infuse or another player that plays video from a web address.

Good to know:

- The link plays the original file, without repackaging or transcoding: the other player has to handle the format itself.
- The link works for 12 hours. It stops working sooner if the device you got it on is disconnected under <Ui k="panel.nav.people" />.
- The link uses the address you opened Torsher with. If that was `localhost`, replace it with the server's address in your network before using the link on another device.
- What you watch in another player isn't saved as your watch position in Torsher.

### Use another media server for files you keep

Files you keep are laid out in the library folder by title, the way Jellyfin, Plex and Kodi expect. If you already run one of them with apps on your devices, point it at that folder. See [Storage](/docs/setup/storage).

## Check

The other player starts the video from the link.

## If something went wrong

- **The other player can't open the link.** Check that the device reaches the server: open `http://<server-address>:8080/api/health` in its browser. See [Troubleshooting](/docs/troubleshooting#panel-unreachable).
- **The link worked before and stopped.** It is older than 12 hours, or the device was disconnected. Get a new link from the player.
- **The other player opens the link but shows no picture or no sound.** It can't play this file's format. Choose another release, or watch in Torsher, where the server converts what the device can't play.

## Next

- [Browser](/docs/tv/browser).
- [Connect a device](/docs/tv/connect).
