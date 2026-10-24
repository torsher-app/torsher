---
title: LG webOS
description: "Install the Torsher app on an LG TV with webOS through Developer Mode, point it at your server and connect it with a code."
---

# LG webOS

The Torsher app for LG TVs is a small launcher: it remembers your server's address and opens the showcase from the server itself. The interface updates with the server, so you install the app once.

::: tip What you'll get
Torsher on the TV home screen, connected to your server, controlled with the remote and the Magic Remote pointer.
:::

<EarlyNotice />

## Before you start

- An LG TV with webOS. The app is tested on an LG C4 (2024); TVs from 2020 (webOS 5) and later are targeted but not tested yet.
- The TV and the server on the same network, and the server's address, for example `192.168.1.10:8080`.
- An LG account for Developer Mode.
- A computer with [Node.js](https://nodejs.org/) for LG's command-line tools that install the app.

::: info No install? Use the TV browser
Open `http://<server-address>:8080/` in the TV's web browser and go to [Connect a device](/docs/tv/connect). The app is still worth it: it opens Torsher straight from the TV home screen and remembers the server.
:::

## 1. Turn on Developer Mode on the TV

LG installs apps from outside its store only in Developer Mode. The steps follow [LG's guide](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app):

1. On the TV, install **Developer Mode** from the LG Content Store.
2. Open it and sign in with your LG account.
3. Turn **Dev Mode Status** on. The TV restarts.
4. Open Developer Mode again, turn **Key Server** on, and note the TV's IP address shown in the app.

::: warning Developer Mode expires
A Developer Mode session lasts a limited time; the app shows how much is left and has a button to extend it. When the session runs out, apps installed in Developer Mode stop working: extend the session and, if Torsher is gone, install it again.
:::

## 2. Install the webOS tools on your computer

```bash
npm install -g @webos-tools/cli
```

Register the TV under the name `tv`, using its IP address from step 1:

```bash
ares-setup-device --add tv --info "{'host': '<tv-ip>', 'port': '9922', 'username': 'prisoner'}"
```

Get the key from the TV. Enter the passphrase shown in the Developer Mode app when asked:

```bash
ares-novacom --device tv --getkey
```

## 3. Install Torsher

Download `app.torsher.webos_<version>_all.ipk` from the [latest release](https://github.com/torsher-app/torsher/releases) and install it:

```bash
ares-install --device tv app.torsher.webos_<version>_all.ipk
```

Torsher appears among the TV's apps.

If your TV already runs Homebrew Channel, you can install the same `.ipk` through it instead. We haven't tested this path yet.

::: details Build the app from source instead
With Node.js 24 and the repository cloned, from the repository folder:

```bash
corepack enable
pnpm install
pnpm --filter @torsher/tv-shell-webos package
pnpm --filter @torsher/tv-shell-webos install:tv
```
:::

## 4. Point it at your server

Open Torsher on the TV. The <Ui k="shell.addressLabel" /> screen asks where your server is:

1. Type the address where the control panel opens, without `/panel/`, for example `192.168.1.10:8080`.
2. Select <Ui k="shell.connect" />.

The app remembers the address and opens the showcase. To change it later, use <Ui k="shell.changeAddress" />.

## 5. Connect with a code

The showcase shows a six-character code. Enter it in the panel under <Ui k="panel.nav.people panel.people.pairDevice" />. Details: [Connect a device](/docs/tv/connect).

## If something went wrong

- **`ares-setup-device` or `ares-install` can't reach the TV.** Check that Dev Mode Status and Key Server are on, and that the IP address is current.
- **The app doesn't connect to the server.** It shows the reason under the address:
  - didn't respond within 5 seconds: the server is off or the TV is on another network;
  - couldn't reach the address: check the address and the port;
  - responded, but it isn't a Torsher server: the port belongs to another app.
- **Torsher stopped opening or disappeared.** The Developer Mode session ran out. Extend it in the Developer Mode app and install Torsher again if needed.

## Next

[Connect a device](/docs/tv/connect), then [Watching](/docs/watch/showcase).
