---
title: Quick start
description: "From an empty folder to a movie on the TV in about ten minutes: start Torsher and Prowlarr with Docker Compose, run the setup wizard and connect the TV."
---

# Quick start

The shortest way from an empty folder to a movie on your TV. Each step links to a page with details if something doesn't go as described.

::: tip What you'll get
Torsher and Prowlarr running on your server, the setup wizard passed, and the TV connected and showing the catalog. About ten minutes.
:::

<EarlyNotice />

## Before you start

- A computer running Linux with [Docker Engine and the Compose plugin](https://docs.docker.com/engine/install/). Not sure about the hardware? See [Requirements](/docs/install/requirements).
- A terminal on that computer, directly or over SSH.
- A TV or a computer on the same network.

## 1. Start Torsher and Prowlarr

Create a folder for Torsher and download the install file into it:

```bash
mkdir torsher && cd torsher
curl -fsSL https://raw.githubusercontent.com/torsher-app/torsher/main/docker-compose.example.yml -o docker-compose.yml
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

Find the server's address in the local network:

```bash
hostname -I
```

Open `http://<server-address>:8080/panel/` in a browser, for example `http://192.168.1.10:8080/panel/`. Create the owner account: it signs in to the control panel. There is one account per server; the household watches through profiles.

## 3. Pass the setup wizard

The wizard checks storage and the network, and looks for Prowlarr. Every check that fails shows <Ui k="panel.wizard.checks.howToFix" />.

When the wizard reaches <Ui k="panel.wizard.steps.sources.title" />, open Prowlarr at `http://<server-address>:9696` in a new tab and add the indexers you are allowed to use. Then copy its API key, paste it into the wizard and select <Ui k="panel.wizard.sources.connect.submit" />.

Details: [Setup wizard](/docs/setup/wizard) and [Indexers](/docs/setup/indexers).

## 4. Connect the TV

On an LG TV, install the [Torsher app](/docs/tv/lg-webos). On any other TV or computer, open `http://<server-address>:8080/` in the browser.

The screen shows a six-character code. In the panel, open <Ui k="panel.nav.people" />, select <Ui k="panel.people.pairTv" /> and enter the code. Details: [Connect a TV](/docs/tv/connect).

## 5. Watch

If the household has several profiles, the TV asks who's watching. Open any title and select <Ui k="title.watch" />. Torsher finds releases in your indexers and starts playback.

## If something went wrong

- The panel doesn't open: check that the container runs with `docker compose ps` and read `docker compose logs torsher`.
- A wizard check is red: [Troubleshooting](/docs/troubleshooting).
- The catalog is empty: the server needs a [TMDB key](/docs/setup/tmdb).
