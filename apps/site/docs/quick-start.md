---
title: Quick start
description: "From an empty folder to a movie on the TV: start Torsher and Prowlarr with Docker Compose, run the setup wizard and connect the TV."
---

# Quick start

The shortest way from an empty folder to a movie on your TV. Each step links to a page with details if something doesn't go as described.

Want to see the control panel first? The [panel demo](/demo/){target="_self"} runs in your browser on made-up data, with nothing to install.

::: tip What you'll get
Torsher and Prowlarr running on your server, the setup wizard passed, and the TV connected and showing the catalog.
:::

## Before you start

- A computer with Docker and the Compose plugin. Linux gets every feature; Windows and macOS work through Docker Desktop, with transcoding on the CPU only (see [Docker Desktop](/docs/install/docker-desktop)). Not sure about the hardware? See [Requirements](/docs/install/requirements).
- The commands below are for Linux and macOS.
- A terminal on that computer, directly or over SSH.
- A TV or a computer on the same network.

## 1. Start Torsher and Prowlarr

Create a folder for Torsher and download the install file into it:

```bash
mkdir torsher && cd torsher
curl -fsSL https://github.com/torsher-app/torsher/releases/latest/download/docker-compose.yml -o docker-compose.yml
```

Find out your user and group IDs:

```bash
id -u && id -g
```

If they are not both `1000`, open `docker-compose.yml` and put them into `PUID` and `PGID`. Then start Torsher together with Prowlarr, the indexer manager:

```bash
docker compose --profile prowlarr up -d
```

Details: [Docker Compose](/docs/install/docker-compose).

## 2. Create the owner account

Find the server's address in the local network. On Linux:

```bash
hostname -I
```

On macOS and Windows, it's in the network settings of the system.

Open `http://<server-address>:8080/panel/` in a browser, for example `http://192.168.1.10:8080/panel/`. Create the owner account: it signs in to the control panel. There is one account per server; the household watches through profiles.

## 3. Pass the setup wizard

The wizard checks storage and the network, and looks for Prowlarr. Every check that fails shows <Ui k="panel.wizard.checks.howToFix" />.

When the wizard reaches <Ui k="panel.wizard.steps.sources.title" />, open Prowlarr at `http://<server-address>:9696` in a new tab and add the indexers you are allowed to use. Then copy its API key, paste it into the wizard and select <Ui k="panel.wizard.sources.connect.submit" />.

Details: [Setup wizard](/docs/setup/wizard) and [Indexers](/docs/setup/indexers).

## 4. Connect the TV

On an LG TV or an Android TV device, install the Torsher app: [LG webOS](/docs/tv/lg-webos), [Android TV](/docs/tv/android-tv). On a computer or a TV with a recent browser, open `http://<server-address>:8080/`.

The screen shows a six-character code. In the panel, open <Ui k="panel.nav.people" />, select <Ui k="panel.people.pairDevice" /> and enter the code. Details: [Connect a device](/docs/tv/connect).

## 5. Watch

If the household has several profiles, the TV asks who's watching. Open any title and select <Ui k="title.watch" />. Torsher finds releases in your indexers and starts playback.

## If something went wrong

- The panel doesn't open: check that the container runs with `docker compose ps` and read `docker compose logs torsher`.
- A wizard check is red: [Troubleshooting](/docs/troubleshooting).
- The catalog is empty: check the [TMDB key](/docs/setup/tmdb).
