---
title: Android TV and Google TV
description: "Install the Torsher app on an Android TV or Google TV device from the APK in the release, point it at your server and connect it with a code."
---

# Android TV and Google TV

The Torsher app for Android TV is a small launcher with a native video player: it remembers your server's address and opens the showcase from the server itself. The interface updates with the server; the app itself is updated from a new release.

::: tip What you'll get
Torsher on the TV home screen, connected to your server and controlled with the remote. Video plays with the device's own decoders; what the device can't play, the server converts.
:::

## Before you start

- An Android TV or Google TV device: a TV, a set-top box or a stick. The app is tested in the Google TV emulator (Android 16). Real devices from Android 7.0 onwards are targeted, but not tested yet.
- The device and the server on the same network, and the server's address, for example `192.168.1.10:8080`.
- A computer with [Android platform tools](https://developer.android.com/tools/releases/platform-tools) (`adb`) to install the app.

::: info No install? Use the TV browser
If the device has a web browser, open `http://<server-address>:8080/` in it and go to [Connect a device](/docs/tv/connect). The app is still worth it: it opens Torsher from the home screen, plays more formats directly and remembers the server.
:::

## 1. Turn on debugging on the device

The app isn't in Google Play yet, so it's installed from a computer with `adb`. Menu names differ between devices; on Google TV:

1. Open **Settings → System → About** and select **Android TV OS build** seven times. Developer options appear.
2. In **Settings → System → Developer options**, turn on **USB debugging** or **Wireless debugging**, whichever the device has.
3. Note the device's IP address in **Settings → Network & Internet**.

## 2. Connect the computer to the device

```bash
adb connect <tv-ip>
```

The TV asks whether to allow debugging from this computer: allow it.

If the device shows **Wireless debugging** with a pairing code, pair first with the address and code from its **Pair device with pairing code** screen, then connect to the address shown on the **Wireless debugging** screen:

```bash
adb pair <tv-ip>:<pairing-port>
```

```bash
adb connect <tv-ip>:<port>
```

## 3. Install Torsher

Download `app.torsher.androidtv_<version>.apk` from the [latest release](https://github.com/torsher-app/torsher/releases) and install it:

```bash
adb install app.torsher.androidtv_<version>.apk
```

Torsher appears among the device's apps. You can turn debugging off afterwards.

::: details Build the app from source instead
With JDK 17, the Android SDK, Node.js 24 and the repository cloned, from the repository folder:

```bash
corepack enable
pnpm install
pnpm --filter @torsher/tv-shell-android build:apk
pnpm --filter @torsher/tv-shell-android install:tv
```

A debug build is signed with a different key, so it doesn't install over the release app: remove one before installing the other.
:::

## 4. Point it at your server

Open Torsher on the device. The <Ui k="shell.addressLabel" /> screen asks where your server is:

1. Type the address where the control panel opens, without `/panel/`, for example `192.168.1.10:8080`.
2. Select <Ui k="shell.connect" />.

The app remembers the address and opens the showcase. To change it later, use <Ui k="shell.changeAddress" /> while the app connects, or <Ui k="about.changeServer" /> in the showcase.

## 5. Connect with a code

The showcase shows a six-character code. Enter it in the panel under <Ui k="panel.nav.people panel.people.pairDevice" />. Details: [Connect a device](/docs/tv/connect).

## Update

When a new version is out, download its APK from the release and install it over the old one:

```bash
adb install -r app.torsher.androidtv_<version>.apk
```

## If something went wrong

- **`adb connect` fails or the device stays `unauthorized`.** Check that debugging is on, the IP address is current, and that you allowed debugging on the TV.
- **The app doesn't connect to the server.** It shows the reason under the address:
  - didn't respond within 5 seconds: the server is off or the device is on another network;
  - couldn't reach the address: check the address and the port;
  - responded, but it isn't a Torsher server: the port belongs to another app.
- **The app says Android System WebView is too old.** Update Android System WebView in Google Play and open Torsher again.

## Next

[Connect a device](/docs/tv/connect), then [Watching](/docs/watch/showcase).
