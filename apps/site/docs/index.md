---
title: What is Torsher
description: "Torsher is a self-hosted media center in one Docker container. A TV-first catalog, watching right away, your own library, and what you need to bring yourself."
---

# What is Torsher

Torsher is a media center you run yourself, in one Docker container on a mini PC, a NAS or a desktop. You browse a catalog on the TV, start watching right away, and keep what you want in your own library.

::: tip What you'll learn
What Torsher does today, what it replaces, what you need to bring, and how the pieces fit together. About five minutes of reading before you [install it](/docs/quick-start).
:::

## What it does

- **A catalog made for the TV.** Movies and series with posters, descriptions, cast and ratings from TMDB, in a showcase you drive with a remote, a mouse or a keyboard.
- **Watch right away.** Pick a title, Torsher finds releases in your indexers, ranks them by quality and voice-over, and starts playback while the file downloads. No waiting for the whole file.
- **Voice-overs are first-class.** Releases show their dubbing and voice-over studios, and the player switches audio and subtitle tracks.
- **Keep what you like.** What you watch stays in a cache that cleans itself up. Choose <Ui k="download.keep" /> or <Ui k="download.movie" /> and the file goes to your library, laid out so Jellyfin, Plex and Kodi can read it too.
- **Your existing files.** Connect the folders you already have: Torsher indexes them in place and never writes there. Home videos get their own section.
- **Plays everywhere.** When a TV or a browser can't play a file, the server converts it on the fly, on the GPU if it has one.
- **For the whole household.** Profiles with a PIN, continue watching, your own lists, ratings and collections.
- **Network that works.** DNS over HTTPS and routes through your own SOCKS5 or HTTP proxy, per host.
- **Looks after itself.** Daily database backups, a notice when a new version is out, and notifications about problems, finished downloads, new episodes of the shows you follow and new devices in Telegram, a webhook, ntfy, Gotify or email.

Coming next: following series so new episodes arrive on their own, and more TV platforms. See [Other devices](/docs/tv/other-devices).

## What it replaces

A typical home media setup wires several apps together: a torrent client, a media server, series and movie managers, and a request app, each with its own interface and database. Torsher does their jobs in one process with one database and one interface.

What stays outside is the **indexer**: the service that searches the sources you are allowed to use. Torsher connects to any Torznab indexer, for example Prowlarr or Jackett.

## What you need

| You need | Why |
| --- | --- |
| A computer with Docker | Torsher runs as one container. A mini PC with an Intel N100 or N150 is plenty. See [Requirements](/docs/install/requirements). |
| A Torznab indexer | Torsher ships with no sources. Prowlarr runs next to Torsher from the same install file. See [Indexers](/docs/setup/indexers). |
| A TMDB key, maybe | The catalog comes from TMDB. If the server has no key, you get a free one from your TMDB account. See [TMDB key](/docs/setup/tmdb). |
| A TV or a browser | The Torsher app on an LG TV, or any modern browser. See [LG webOS](/docs/tv/lg-webos). |

## How the pieces fit

```text
TV app or browser ──▶ Torsher (one container, one port)
                        ├─▶ TMDB               catalog, posters, descriptions
                        ├─▶ your indexer       Torznab search for releases
                        ├─▶ torrent engine ──▶ peers
                        └─▶ /data
                              ├─ torrents/     cache: what you watch
                              └─ library/      what you keep
```

- The TV and the browser talk only to your server. Images and descriptions come through it too.
- The control panel at `/panel/` is where you set things up: sources, network, storage, profiles and devices.
- Everything Torsher writes lives in one `/data` volume, so a backup is one folder.

## What Torsher does not do

- It does not include, host or index any content and comes with no sources enabled. You choose the sources you connect and are responsible for making sure you are allowed to use them.
- It collects no telemetry and needs no cloud account. The server talks only to TMDB, your indexers, torrent peers, the proxies and notification channels you set up, GitHub to check for new versions (you can turn this off) and, if you turn on IMDb ratings, the official IMDb dataset.

## Next

[Quick start](/docs/quick-start): from an empty folder to a movie on the TV.
