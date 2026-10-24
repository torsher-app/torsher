---
title: Setup wizard
description: "What the first-run wizard checks and asks: the owner account, storage, network access to TMDB, sources and connecting a TV."
---

# Setup wizard

The first time you open the control panel, a wizard walks you through five steps. Each step checks the server and tells you how to fix what it finds. Everything you set here can be changed later in the panel.

::: tip What you'll get
An owner account, storage and network checked, an indexer connected, and the address to open on your TV.
:::

## Before you start

- Torsher is running. See [Docker Compose](/docs/install/docker-compose).
- Open `http://<server-address>:8080/panel/` in a browser on any device in your network.

## How a step works

Each step starts with <Ui k="panel.wizard.checks.title" />: a list of what the server tested, with a status next to each line. A line with a problem has <Ui k="panel.wizard.checks.howToFix" />: open it, follow it, then select <Ui k="panel.wizard.checks.retry" />.

You can leave any step with <Ui k="panel.wizard.actions.skip" /> or <Ui k="panel.wizard.actions.later" /> and finish it in the panel.

## 1. Account

Create the owner account: name, email and password. The email is only for signing in; the server sends no email. There is one account per server. The household watches through profiles that you add later.

Forgot the password later? See [Reset the password](/docs/maintain/reset-password).

## 2. Storage

The server checks where it keeps the database, downloads and the library:

- <Ui k="panel.wizard.storage.data.ok" />, <Ui k="panel.wizard.storage.downloads.ok" /> and <Ui k="panel.wizard.storage.library.ok" />. If a folder is not writable, `PUID` and `PGID` don't match the owner of the folder on the host.
- **Free space** on the downloads volume against the cache limit and the reserve.
- **How kept files reach the library:** a hard link, a reflink or a copy. A copy means downloads and the library are on different volumes. See [Docker Compose](/docs/install/docker-compose#several-disks).

Below the checks, set two limits:

- <Ui k="panel.settings.storage.cacheTitle" />: how much space what you watch may take. When the cache is full, the oldest items are deleted.
- <Ui k="panel.settings.storage.reserveTitle" />: below this much free space, new playback doesn't start and downloads pause. At least 20 GB is a good start.

Defaults are based on the disk size, so <Ui k="panel.wizard.actions.next" /> is fine if you're unsure.

## 3. Network

The catalog and posters come from TMDB. The server checks that it reaches <Ui k="panel.wizard.network.hosts.tmdb" /> and <Ui k="panel.wizard.network.hosts.tmdb_images" /> and that the TMDB key works.

- **A host doesn't resolve or its DNS is spoofed.** Choose DNS over HTTPS in the <Ui k="panel.settings.network.dnsCard.title" /> card, save it and select <Ui k="panel.wizard.checks.retry" />.
- **A host is unreachable from your network.** Finish the wizard, then add a route through your proxy in <Ui k="panel.nav.settings panel.settings.nav.network" />. See [Network](/docs/setup/network).
- **<Ui k="panel.wizard.network.key.missing" /> or <Ui k="panel.wizard.network.key.rejected" />.** Paste your own key in the card below the checks. See [TMDB key](/docs/setup/tmdb).

## 4. Sources

Torsher finds releases in Torznab indexers. The wizard looks for Prowlarr and Jackett nearby: compose services named `prowlarr` and `jackett`, the Docker host, the container network gateway and this machine, on ports 9696 and 9117.

- **A manager is found.** Paste its API key and select <Ui k="panel.wizard.sources.connect.submit" />. Torsher adds all its indexers and keeps them in sync.
- **It runs somewhere else.** Use <Ui k="panel.wizard.sources.none.importTitle" />: the address as the Torsher server reaches it, and the API key.
- **You have no indexer yet.** Start Prowlarr from the install file and select <Ui k="panel.wizard.checks.retry" />.

Where to find the API key and how to start Prowlarr: [Indexers](/docs/setup/indexers).

Without sources the catalog works, but there is nothing to watch from.

## 5. Done

The last step lists what is set up and what you skipped. Under <Ui k="panel.wizard.done.tvTitle" /> it shows the address to open on the TV: in the [Torsher app](/docs/tv/lg-webos) or in a browser. The TV shows a six-character code; enter it right there.

<Ui k="panel.wizard.done.openShowcase" /> opens the showcase in this browser, <Ui k="panel.wizard.done.toPanel" /> takes you to the panel.

## If something went wrong

See [Troubleshooting](/docs/troubleshooting) for each check the wizard runs.

## Next

- [Connect a TV](/docs/tv/connect).
- [Indexers](/docs/setup/indexers), if you skipped sources.
