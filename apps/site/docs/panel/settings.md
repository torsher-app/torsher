---
title: Settings
description: "Every server setting in the control panel: storage, torrent, following, backups, network, metadata, playback, notifications, account and about."
---

# Settings

<Ui k="panel.nav.settings" /> is at the bottom of the panel sidebar. Each subsection below lists what it controls. Most have a detailed page of their own; <Ui k="panel.settings.nav.torrent" /> and <Ui k="panel.settings.nav.notifications" /> are described in full here.

::: tip What you'll learn
Where each setting lives, what the defaults are, and which page explains it in detail.
:::

## Storage

<Ui k="panel.nav.settings panel.settings.nav.storage" /> decides where downloads live and how much space the watch cache may take:

- how the downloads disk is used: kept torrents, cache, library, other files and free space;
- <Ui k="panel.settings.storage.cacheTitle" /> and <Ui k="panel.settings.storage.reserveTitle" />. Until you change them, defaults based on the disk size apply;
- <Ui k="panel.settings.storage.queue.title" />: the torrents the cache removes first;
- <Ui k="panel.settings.storage.library.title" />: how much the library takes and whether kept files are hard-linked or copied;
- <Ui k="panel.settings.storage.folders.title" />: the downloads and library folders, and moving existing data to a new folder.

See [Storage](/docs/setup/storage).

## Torrent

<Ui k="panel.nav.settings panel.settings.nav.torrent" /> controls speed, the download queue, seeding and the engine's network. Each card shows its default and saves on its own.

### Speed

- **<Ui k="panel.settings.torrent.download.title" />,** in MB/s. Limits downloads and torrents added in the panel. Watching ignores the limit, so video doesn't stutter. Empty means no limit, the default.
- **<Ui k="panel.settings.torrent.upload.title" />,** in MB/s. Limits everything the engine uploads to peers, including while watching. On a slow connection, uploads can fill it up and make video stutter. Empty means no limit, the default.

### Queue and seeding

- **<Ui k="panel.settings.torrent.queue.title" />.** How many downloads run at once: 3 by default, from 0 to 100. The rest wait, but you can already watch them. 0 means no queue: everything downloads at once.
- **<Ui k="panel.settings.torrent.seedRule.title" />.** What happens to files you downloaded in full:
  - <Ui k="panel.settings.torrent.seedRule.modes.always" />, the default;
  - <Ui k="panel.settings.torrent.seedRule.modes.ratio" />: uploaded divided by size, from 0.1 to 100. 2 means upload twice what you downloaded;
  - <Ui k="panel.settings.torrent.seedRule.modes.time" />: in hours or days, counted from when the download finished, from 1 hour to 10 years;
  - <Ui k="panel.settings.torrent.seedRule.modes.never" />.

  While a download is in progress or someone watches it, it always seeds. A single download can have its own rule in its card, see [Downloads](/docs/panel/downloads#seeding-rule-for-one-torrent).
- **<Ui k="panel.settings.torrent.seedCache.title" />.** With <Ui k="panel.settings.torrent.seedCache.label" /> on (the default), torrents you only watched stay in the cache and seed until the cache removes them. Turn it off if uploads get in the way.

### Connections

- **<Ui k="panel.settings.torrent.conns.title" />.** How many peers at once: <Ui k="panel.settings.torrent.conns.perTorrent" /> 50 by default (1 to 1000), <Ui k="panel.settings.torrent.conns.total" /> 200 (0 to 10,000; 0 means no overall limit). Many connections are hard on a weak router or NAS. A torrent being watched always gets the full per-torrent limit.
- **<Ui k="panel.settings.torrent.port.title" />.** The port peers connect to, from 1024 to 65,535. By default it's the `ENGINE_PEER_PORT` variable or, without it, a random port chosen once. If the port is open on the router, you get more peers. In Docker, publish the same port in `docker-compose.yml`: the card warns when they differ. See [Configuration](/docs/install/configuration).

  <Ui k="panel.settings.torrent.port.upnp" /> lets the router open the port itself. It's off by default: not every router does this safely.
- **<Ui k="panel.settings.torrent.discovery.title" />.** Where the engine looks for peers besides trackers: <Ui k="panel.settings.torrent.discovery.dht" />, a shared peer network without trackers, and <Ui k="panel.settings.torrent.discovery.pex" />, where peers share the addresses of other peers. Both are on by default. Private trackers require them off. Without DHT, watching takes longer to find peers, and magnet links without trackers won't open.
- **<Ui k="panel.settings.torrent.encryption.title" />** of connections with peers. <Ui k="panel.settings.torrent.encryption.prefer" /> (the default) encrypts when the peer supports it and keeps the most peers. <Ui k="panel.settings.torrent.encryption.require" /> allows encrypted connections only: fewer peers, and playback starts slower.

### Engine restart

The engine reads the port, UPnP, peer discovery and encryption when it starts. Their cards are marked <Ui k="panel.settings.torrent.restartBadge" />, and after you save one, the page says <Ui k="panel.settings.torrent.restart.title" />. Select <Ui k="panel.settings.torrent.restart.button" />: playback on every device pauses for a few seconds and resumes on its own, and downloads continue. The dialog says how many torrents are being watched right now. While downloads are being moved to another folder, the restart is unavailable until the move finishes.

All other torrent settings apply right away.

## Following

<Ui k="panel.nav.settings panel.settings.nav.follow" />: how often the new releases feed is read, how many targeted searches run per hour, and the rules new follows get. See [Following](/docs/panel/follow#settings).

## Backups

<Ui k="panel.nav.settings panel.settings.nav.backups" />: the backup schedule, the backup folder, password protection, the list of backups with restore and download, and moving data between servers. See [Backup and move](/docs/maintain/backup).

## Network

<Ui k="panel.nav.settings panel.settings.nav.network" /> decides how the server reaches TMDB, indexers and managers: directly or through your SOCKS5 or HTTP proxy, with the system DNS or DNS over HTTPS.

- <Ui k="panel.settings.network.hosts.title" />: the hosts the server talks to, checked from the server, not from your browser;
- <Ui k="panel.settings.network.dnsCard.title" />: the DNS for hosts without their own route;
- <Ui k="panel.settings.network.routes.title" />: which hosts go through a proxy or another DNS.

See [Network](/docs/setup/network).

## Metadata

<Ui k="panel.nav.settings panel.settings.nav.metadata" /> decides where the catalog takes titles, posters and descriptions from.

- **<Ui k="panel.settings.metadata.tmdbTitle" />.** Choose the key the catalog uses: the server's own one, which is the <Ui k="panel.settings.metadata.env" /> from `TMDB_ACCESS_TOKEN` if it is set and the <Ui k="panel.settings.metadata.app" /> built into the image otherwise, or <Ui k="panel.settings.metadata.custom" /> from your TMDB account. <Ui k="panel.settings.metadata.check.action" /> tests it. See [TMDB key](/docs/setup/tmdb).
- **<Ui k="panel.settings.metadata.imdb.title" />.** Off by default. With <Ui k="panel.settings.metadata.imdb.toggle" /> on, the server downloads the official IMDb ratings dataset once a day and keeps it locally, and the showcase shows the IMDb rating next to TMDB. The dataset is for personal and non-commercial use: turning it on means you accept the IMDb terms. <Ui k="panel.settings.metadata.imdb.refresh" /> downloads it right away.

## Playback

<Ui k="panel.nav.settings panel.settings.nav.playback" /> shows how the server transcodes video a device can't play by itself.

- **<Ui k="panel.settings.playback.accel.title" />.** Whether a GPU was found and passed the test encode on startup, and what it decodes. Turn off <Ui k="panel.settings.playback.useGpu" /> if the GPU produces artifacts: the CPU encodes instead. <Ui k="panel.settings.playback.check" /> repeats the test.
- **<Ui k="panel.settings.playback.transcode.title" />.** Up to which resolution the CPU keeps up, measured on startup, and how HDR video is converted for screens without HDR. Larger video is scaled down.

See [Hardware transcoding](/docs/install/hardware-acceleration).

## Notifications

<Ui k="panel.nav.settings panel.settings.nav.notifications" /> sends server events to Telegram, a webhook, ntfy, Gotify, email or apprise-api, so you learn about them when the panel is closed. The bell in the panel always gets every event, with or without channels.

### Add a channel

1. Select <Ui k="panel.notifications.add" /> and choose where to send messages:

   | Channel | What to enter |
   | --- | --- |
   | <Ui k="panel.notifications.kinds.telegram" /> | Create a bot with BotFather in Telegram and paste its <Ui k="panel.notifications.fields.botToken" />. Send `/start` to the bot, then select <Ui k="panel.notifications.telegram.find" /> to pick the <Ui k="panel.notifications.fields.chatId" />, or enter a chat ID or the `@name` of a public channel. |
   | <Ui k="panel.notifications.kinds.webhook" /> | The <Ui k="panel.notifications.fields.webhookUrl" />. Discord and Slack addresses are recognized; any other address gets Torsher JSON. Set <Ui k="panel.notifications.fields.format.label" /> by hand if needed, and an optional <Ui k="panel.notifications.fields.authorization" />. Keep the address private: it works as a key. |
   | <Ui k="panel.notifications.kinds.ntfy" /> | The <Ui k="panel.notifications.fields.server" /> (`https://ntfy.sh` by default), a <Ui k="panel.notifications.fields.topic" /> that is hard to guess, and an optional <Ui k="panel.notifications.fields.accessToken" />. Subscribe to the same topic in the ntfy app. On a public server, anyone who knows the topic can read it. |
   | <Ui k="panel.notifications.kinds.gotify" /> | Your Gotify <Ui k="panel.notifications.fields.server" /> and the <Ui k="panel.notifications.fields.appToken" /> of an application created in Gotify. |
   | <Ui k="panel.notifications.kinds.email" /> | The <Ui k="panel.notifications.fields.smtpHost" /> and <Ui k="panel.notifications.fields.port" /> of any SMTP server, the <Ui k="panel.notifications.fields.security.label" /> (STARTTLS on port 587 by default), a username and password if the server needs them, and the <Ui k="panel.notifications.fields.from" /> and <Ui k="panel.notifications.fields.to" /> addresses. |
   | <Ui k="panel.notifications.kinds.apprise" /> | The address of your own apprise-api server, and either a <Ui k="panel.notifications.fields.appriseKey" /> saved in it or <Ui k="panel.notifications.fields.appriseUrls" />. It reaches the services apprise-api supports. |

2. Under <Ui k="panel.notifications.fields.events" />, choose what the channel gets:

   | Group | What it covers | On for a new channel |
   | --- | --- | --- |
   | <Ui k="panel.notifications.groups.problems" /> | The same problems as <Ui k="panel.overview.attention.title" />: engine, storage, indexers, network, TMDB | Yes |
   | <Ui k="panel.notifications.groups.updates" /> | A new Torsher version is available | Yes |
   | <Ui k="panel.notifications.groups.downloads" /> | Files you chose to download are fully downloaded | No |
   | <Ui k="panel.notifications.groups.devices" /> | A TV was connected with a code | No |
   | <Ui k="panel.notifications.groups.follow" /> | New episodes in the library, and episodes with no releases for a long time | Yes |

   Under <Ui k="panel.notifications.groups.problems" />, two more options, off by default: <Ui k="panel.notifications.fields.includeWarnings" /> and <Ui k="panel.notifications.fields.notifyResolved" />.
3. Choose the <Ui k="panel.notifications.fields.language" />, which doesn't depend on the panel language, and check the <Ui k="panel.notifications.fields.panelUrl" /> used for links in messages.
4. Select <Ui k="panel.notifications.test.send" /> to check the settings before saving, then <Ui k="panel.common.save" />.

### The list of channels

Each channel shows its kind, its event groups, and when it last sent a message or why the last one wasn't delivered. The switch turns a channel off without deleting it. Its menu has <Ui k="panel.notifications.edit" />, <Ui k="panel.notifications.test.send" /> and <Ui k="panel.common.delete" />.

Tokens and passwords are stored encrypted and aren't shown again. When you edit a channel, a saved secret shows as <Ui k="panel.notifications.dialog.savedSecret" />: leave it empty to keep it. If you change the channel's server address, enter the secret again.

### If a test fails

| Message | What to check |
| --- | --- |
| <Ui k="panel.notifications.test.errors.unauthorized" /> | The token or password. |
| <Ui k="panel.notifications.test.errors.not_found" /> | The chat, topic or address. For Telegram, send `/start` to the bot first. |
| <Ui k="panel.notifications.test.errors.rate_limited" /> | Wait and try again. |
| <Ui k="panel.notifications.test.errors.unavailable" /> | The address, and whether the server reaches it. A route in [Network](/docs/setup/network) may be needed. |
| <Ui k="panel.notifications.test.errors.invalid_response" /> | The settings of the receiving service. |
| <Ui k="panel.notifications.test.errors.invalid_config" /> | Fill in the missing fields, or enter the saved secret again. |

## Account

<Ui k="panel.nav.settings panel.settings.nav.account" /> holds the server owner account. There is only one: the household watches through profiles, see [Profiles and devices](/docs/panel/profiles-devices).

- **<Ui k="panel.settings.account.usernameTitle" />.** You sign in with it, and the panel calls you by it. 2 to 64 characters; changing it needs your current password.
- **<Ui k="panel.settings.account.passwordTitle" />.** Enter the current password and a new one of at least 8 characters, twice.

After you change the username or the password, all other browsers and devices are signed out of the panel. Forgot the password? See [Reset the password](/docs/maintain/reset-password).

The panel language and theme are in the account menu at the bottom of the sidebar.

## About

<Ui k="panel.nav.settings panel.settings.nav.about" /> shows the server version and commit, the license, a link to the source code, and the TMDB attribution. It opens without signing in too, from the sign-in page.

Under <Ui k="panel.updates.title" />:

- <Ui k="panel.updates.toggle" />: once a day the server checks the project's releases on GitHub. The request carries no data about you or the server. When off, the server never contacts GitHub.
- <Ui k="panel.updates.channel" />: <Ui k="panel.updates.channels.stable" /> or <Ui k="panel.updates.channels.beta" />.
- <Ui k="panel.updates.check" />.

See [Update and roll back](/docs/maintain/update). Add the version and commit to a bug report, see [Logs and diagnostics](/docs/maintain/logs#what-to-put-in-a-bug-report).

## Next

- [Troubleshooting](/docs/troubleshooting).
- [Backup and move](/docs/maintain/backup).
