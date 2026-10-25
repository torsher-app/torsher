---
title: FAQ
description: "Short answers to common questions about Torsher: price, sources, Jellyfin and Plex, TVs, GPUs, privacy and household use."
---

# FAQ

Short answers, with links to the pages that explain more.

## Is Torsher free?

Yes. Torsher is open source under the AGPL-3.0 license. There are no paid features, no ads and no accounts with us. The project lives on [donations](/donate), which buy nothing in the product.

## Does Torsher come with movies or sources?

No. Torsher includes, hosts and indexes no content. You connect the Torznab indexers you are allowed to use, for example through Prowlarr or Jackett, and you are responsible for them. See [Indexers](/docs/setup/indexers) and [Legal and attribution](/docs/legal).

## Do I need a TMDB account?

No. The image comes with an app key for the catalog. Your own key is optional, for example if the app key stops working for you. See [TMDB key](/docs/setup/tmdb).

## Can I use it with Jellyfin, Plex or Kodi?

Yes, side by side. Torsher lays out the files you keep by title, with the TMDB ID in folder names, so Jellyfin, Plex and Kodi can read the library folder too. And Torsher can add the folders you already have, read-only. See [Storage and library](/docs/setup/storage).

## Which TVs work?

LG TVs with webOS through the Torsher app, and any TV or computer with a recent browser. The app is tested on an LG C4; older webOS versions are targeted but not tested yet. Apps for other platforms are planned. See [Requirements](/docs/install/requirements#tvs-and-browsers) and [LG webOS](/docs/tv/lg-webos).

## Does it work without a GPU?

Yes. A GPU only helps when a device can't play a file as it is and the server has to convert it. Without a GPU the CPU does that and scales large video down when it can't keep up. Most files modern TVs play directly need no conversion. See [Hardware transcoding](/docs/install/hardware-acceleration).

## What hardware do I need?

Any computer that runs Docker: a mini PC, a NAS or a desktop, x86-64 or arm64. An Intel N100 or N150 mini PC is a good fit. See [Requirements](/docs/install/requirements).

## Do I have to download the whole movie before watching?

No. Torsher streams a torrent while it downloads: playback starts once there is enough of the file. What you watch goes to a cache that cleans itself up; what you want to keep goes to your library. See [Download and keep](/docs/watch/download-keep).

## Can the whole household use it?

Yes. There is one owner account for the control panel, and everyone watches in their own profile with their own history, lists and ratings. A profile can have a PIN. See [Profiles and PIN](/docs/watch/profiles).

## Does Torsher collect data about me?

No. It has no telemetry and needs no cloud account. The server talks only to TMDB, your indexers, torrent peers, the proxies and notification channels you set up, GitHub to check for new versions (you can turn this off) and, if you turn on IMDb ratings, the official IMDb dataset.

## Can I watch outside my home network?

Yes, through a reverse proxy or a VPN to your home network. See [Remote access](/docs/install/remote-access).

## How do I update or back it up?

Two commands update it; the server backs up its database every day on its own. See [Update and roll back](/docs/maintain/update) and [Backup and move](/docs/maintain/backup).

## I forgot the password. What now?

Run one command on the server. See [Reset the password](/docs/maintain/reset-password).

## Something doesn't work. Where do I start?

[Troubleshooting](/docs/troubleshooting) covers each check the server runs. If that doesn't help, [report the problem](/docs/maintain/logs#what-to-put-in-a-bug-report).
