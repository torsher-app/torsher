---
title: Connect a device
description: "Connect a TV, a computer or another device to Torsher with a six-character code, pick a profile, and disconnect a device later."
---

# Connect a device

A TV or a browser doesn't sign in with the owner password. It shows a short code, you confirm it in the control panel from your phone or computer, and the device is connected for good. The steps below use a TV; a browser works the same way and shows <Ui k="connect.titleWeb" />.

::: tip What you'll get
The TV shows <Ui k="profiles.title" /> or goes straight to the home screen, and appears under <Ui k="panel.people.devices.group" /> in the panel.
:::

## Before you start

- The [setup wizard](/docs/setup/wizard) is done, or at least the owner account exists.
- The TV runs the Torsher app for [LG webOS](/docs/tv/lg-webos) or [Android TV](/docs/tv/android-tv), or has the showcase open in its browser at `http://<server-address>:8080/`.
- Your phone or computer can open the control panel.

## 1. Get the code on the TV

The TV shows <Ui k="connect.titleTv" /> with a six-character code. The code refreshes on its own, so you don't have to hurry.

## 2. Enter the code in the panel

1. On your phone or computer, open the panel at `http://<server-address>:8080/panel/`.
2. Open <Ui k="panel.nav.people" /> and select <Ui k="panel.people.pairDevice" />.
3. Type the code from the TV screen. A code is valid for 10 minutes.
4. Give the device a name, for example <Ui k="panel.people.pair.nameDefault" />, and select <Ui k="panel.people.pair.submit" />.

The last step of the setup wizard has the same code field.

## 3. Choose a profile

The TV moves on by itself within a few seconds:

- with one profile without a PIN, it opens the home screen;
- otherwise it asks <Ui k="profiles.title" />. A profile with a lock asks for its four-digit PIN.

To switch later, select your avatar and name near the bottom of the side menu on the TV.

## Without a code

On a computer where you are signed in to the panel, the showcase opens without a code. On the code screen, <Ui k="connect.owner" /> takes you to the panel sign-in and back.

## Disconnect a device

In <Ui k="panel.nav.people" />, open the device's menu under <Ui k="panel.people.devices.group" /> and select <Ui k="panel.people.devices.revoke" />. The TV returns to the code screen and has to connect again.

## If something went wrong

- **<Ui k="panel.people.pair.errorTitles.invalid" />.** Check the code on the TV and type it again.
- **<Ui k="panel.people.pair.errorTitles.expired" />.** The TV already shows a new code: enter that one.
- **The TV shows <Ui k="connect.error" />.** The TV doesn't reach the server. Check that the server is running and that the TV is on the same network.

## Next

[Watching](/docs/watch/showcase): the showcase and the remote.
