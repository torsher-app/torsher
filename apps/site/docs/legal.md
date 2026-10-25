---
title: Legal and attribution
description: "What Torsher does not do, your responsibility for sources, the license, and data attributions."
---

# Legal and attribution

Torsher is free software that you run on your own server. This page explains what it does and doesn't do, which license it is under, and where its movie data comes from. It describes the software and is not legal advice.

::: tip What you'll learn
Who is responsible for what, the terms of the license, and the notices the data providers require.
:::

## What Torsher does not do

- **It includes no content.** Torsher does not include, host or index any content. There are no movies, series or torrents in the software, the image or this website.
- **It comes with no sources.** After the install, nothing is connected: no indexers and no addresses are filled in. You connect the sources yourself, for example any Torznab indexer such as Prowlarr or Jackett. See [Indexers](/docs/setup/indexers).
- **The project runs no servers for your content.** There is no shared cache, mirror, index of torrents or relay. Your server downloads and plays everything itself.
- **It sends no telemetry.** There are no usage statistics and no automatic crash reports. The only request your server makes on the project's behalf is the update check: once a day it asks GitHub for the project's releases, without identifiers or data about your server. Turn it off under <Ui k="panel.nav.settings panel.settings.nav.about" />, switch <Ui k="panel.updates.toggle" />.

## Your responsibility

You choose the sources you connect and are responsible for making sure you are allowed to use them.

## License

Torsher is licensed under the [GNU Affero General Public License v3.0 only](https://github.com/torsher-app/torsher/blob/main/LICENSE) (AGPL-3.0-only). © 2026-present Anton Reshetov.

You may use, study, change and share Torsher under that license. If you change Torsher and let other people use your changed version over a network, the license asks you to offer them its source code. Read the license for the exact terms.

The <Ui k="about.title" /> screen in the panel and on the TV shows the version, the commit and a link to the source code of the running server. In the panel it is under <Ui k="panel.nav.settings panel.settings.nav.about" />; on the TV it is <Ui k="common.about" /> in the side menu.

## TMDB

Movie and series information and images in the catalog come from [The Movie Database (TMDB)](https://www.themoviedb.org/).

> This product uses the TMDB API but is not endorsed or certified by TMDB.

The <Ui k="about.title" /> screen in the panel and on the TV shows this notice next to the TMDB logo. The logo is smaller and less prominent than the Torsher mark, with its colors and proportions unchanged, as TMDB's terms require.

- Your server keeps data and images from TMDB for no longer than 6 months, and tells browsers to keep cached images no longer than that either.
- The image comes with an app key for TMDB. You can use your own key instead, and TMDB can withdraw the app key at any time. See [TMDB key](/docs/setup/tmdb).
- TMDB's own terms: [API Terms of Use](https://www.themoviedb.org/api-terms-of-use).

## IMDb ratings

IMDb ratings are off by default. The owner turns them on in the panel under <Ui k="panel.nav.settings panel.settings.nav.metadata" />, card <Ui k="panel.settings.metadata.imdb.title" />, switch <Ui k="panel.settings.metadata.imdb.toggle" />. The card says that the IMDb dataset is for personal and non-commercial use and links to <Ui k="panel.settings.metadata.imdb.termsLink" />; turning it on means accepting them.

When it is on, your server downloads the official ratings file `title.ratings.tsv.gz` from `datasets.imdbws.com` once a day and keeps it locally. It doesn't use the IMDb website or any other IMDb data. There is no IMDb data in Torsher's repository or image, and the project keeps no copy of the dataset.

While IMDb ratings are on, the <Ui k="about.title" /> screen in the panel and on the TV shows:

> Information courtesy of IMDb (https://www.imdb.com). Used with permission.

## Third-party components

Torsher includes components from other projects under their own licenses. The full list with license texts is in [THIRD_PARTY_LICENSES](https://github.com/torsher-app/torsher/blob/main/THIRD_PARTY_LICENSES). In short:

| Component | License |
| --- | --- |
| Onest font, in the showcase, the panel and this site | SIL Open Font License 1.1 |
| JetBrains Mono font, on this site | SIL Open Font License 1.1 |
| Node.js, the base of the Docker image | MIT |
| The torrent engine, built from Torsher's repository | AGPL-3.0-only, like Torsher. It links Go modules under MIT, BSD, ISC, Apache-2.0 and MPL-2.0, including anacrolix/torrent (MPL-2.0) |
| FFmpeg, the Debian package | GPL-2.0 or later, built by Debian without non-free components. Torsher runs it as a separate program |
| tini | MIT |
| Mesa graphics drivers | MIT |
| Intel Media Driver, in the amd64 image only | MIT and BSD-3-Clause |

Inside the image, the license files of the engine's Go modules are in `/usr/share/licenses/torsher-engine`, the Debian packages carry theirs in `/usr/share/doc/<package>/copyright`, and each server dependency in `/app/server/node_modules` has its own license file.
