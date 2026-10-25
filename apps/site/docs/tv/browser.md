---
title: Browser
description: "Use the Torsher showcase in a browser on a TV, a computer or a phone: the address, connecting, the mouse and keyboard, and what the server converts."
---

# Browser

The showcase is a web page your server serves itself, so it opens in a browser with nothing to install: on a computer, in a TV's built-in browser or on a phone.

::: tip What you'll get
The showcase in a browser, connected to your server, playing what you pick.
:::

## Before you start

- Torsher is running, and the owner account exists. See the [setup wizard](/docs/setup/wizard).
- The device is in the same network as the server, or reaches it through [remote access](/docs/install/remote-access).
- A current browser. Torsher is developed and checked in Chrome; other current browsers are expected to work. The showcase is built to run on browser engines as old as Chromium 68, the one in LG webOS 5 TVs, but browsers built into TVs are not tested yet.

## 1. Open the address

In the browser, open:

```text
http://<server-address>:8080/
```

This is the address of the panel without `/panel/` at the end. On the server itself, `http://localhost:8080/` works too.

## 2. Connect the browser

The browser shows <Ui k="connect.titleWeb" /> with a six-character code. Enter it in the panel under <Ui k="panel.nav.people panel.people.pairDevice" />, from your phone or another computer. Details: [Connect a device](/docs/tv/connect).

If you are signed in to the panel in the same browser, the showcase opens without a code. On the code screen, <Ui k="connect.owner" /> takes you to the panel sign-in and back.

Then pick a profile, if the server has more than one.

## 3. Find your way around

The showcase is made for a TV remote, and a mouse and keyboard work as well:

| Do this | Mouse | Keyboard |
| --- | --- | --- |
| Move around | Point at an item: it lights up | Arrow keys |
| Open, select | Click | <kbd>Enter</kbd> |
| Go back | — | <kbd>Esc</kbd> or <kbd>Backspace</kbd> |
| Actions for a poster or episode | Right-click | Hold <kbd>Enter</kbd>, or the menu key |
| Scroll | The scroll wheel, as on any page | Arrow keys |
| Pause and play | Click the button in the player | <kbd>Space</kbd> |

Digits type a profile PIN. On a touch screen, a tap selects and a long tap opens the actions, like a right-click.

For a TV-like picture on a computer, switch the browser to full screen. More about sections and the player: [Showcase and remote](/docs/watch/showcase).

::: info On a phone
The showcase opens on a phone, but its layout is made for a landscape TV screen and scales to the width of the window: in portrait, everything is small. Turn the phone sideways, or use the phone for the panel and for entering codes.
:::

## What plays directly and what the server converts

When you press play, the browser tells the server which formats it can play, and the server picks the lightest way:

| What happens | When |
| --- | --- |
| **Plays as is** | The browser plays the container, the video and the chosen audio track itself, for example H.264 video with AAC audio in MP4 |
| **Repackaged** | The video is fine, but the browser can't open the container (MKV in most browsers), can't play the audio (AC3, DTS), can't switch audio tracks or show the subtitles inside the file. The server repackages the file into a stream without re-encoding the video; audio the browser can't play is converted to AAC |
| **Transcoded** | The browser can't decode the video: HEVC in many browsers, old Xvid and DivX files, 10-bit H.264, or image subtitles that have to be burned into the picture. The server converts the video to H.264 |

Transcoding uses the server's GPU when it has one and the CPU otherwise. See [Hardware transcoding](/docs/install/hardware-acceleration).

When the browser can't switch audio tracks itself, and in every repackaged or transcoded stream, choosing another audio track restarts the stream from the current position. The player's <Ui k="player.audio" /> panel says so.

The [LG webOS app](/docs/tv/lg-webos) plays more on its own than a browser: MKV, HEVC, AC3 and E-AC3 play there without repackaging.

## Check

The showcase opens the home screen, and a movie or episode starts playing after you choose a source.

## If something went wrong

- **The browser shows <Ui k="connect.error" />.** It doesn't reach the server. See [Troubleshooting](/docs/troubleshooting#tv-no-code).
- **The page doesn't open at all.** Check the address and that the device is in the same network. See [Troubleshooting](/docs/troubleshooting#panel-unreachable).
- **The player says <Ui k="player.errors.unsupported.title" />.** The browser can't play this file and the server couldn't convert it. See [Troubleshooting](/docs/troubleshooting#unsupported).

## Next

- [Showcase and remote](/docs/watch/showcase).
- [The player](/docs/watch/player).
