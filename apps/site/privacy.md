---
title: Privacy Policy
description: "What data Torsher, the LG TV app and this site collect and where it goes: the server and the TV app send the project nothing, the site uses Google Analytics."
sidebar: false
aside: false
outline: false
---

# Privacy Policy

Torsher is software you run on your own hardware. The Torsher server and the TV app send the project nothing: no accounts, no telemetry, no analytics and no automatic crash reports. Only this website measures visits, with Google Analytics, as described below. This page applies to the Torsher server, the Torsher app for LG TVs and this website.

## The Torsher server

Torsher stores the owner account, profiles, connected devices, your library, watch positions, viewing diary, notes, viewing context, ratings, lists, settings and logs on the server you run. The project never receives a copy. Backups and exports are files on your server that only you handle.

The server connects to these services, and only for the purposes described:

- **TMDB**, for movie and series information, images and recommendation candidates. Requests can include title IDs chosen from your ratings, favorites or history, along with catalog filters and language. These IDs can reveal an interest in a title. Your diary timestamps, ratings themselves, notes and viewing context are not sent with recommendation requests.
- **The indexers, proxies and notification channels you set up**, with the addresses and keys you entered.
- **Torrent peers**, when you watch or download a torrent.
- **GitHub**, once a day, to check the project's releases for a new version. The request carries no identifiers or data about your server. Turn it off in the panel under <Ui k="panel.nav.settings panel.settings.nav.about" />.
- **The official IMDb ratings dataset**, once a day, only if you turn IMDb ratings on.

Each of these services handles the request under its own privacy policy.

History files you upload from Letterboxd or Trakt are parsed on your server. Matching their titles can query TMDB using title names or IDs. Torsher does not sign in to those services or open links from the files. Your diary facts and notes are kept separately from the limited catalog cache; removing cached metadata does not remove your personal entries.

## The Torsher app for LG TVs

The TV app keeps only the address of your server and the session of your connected TV, on the TV itself. It connects only to the server whose address you enter, and everything you see after that comes from your server. The app collects no data and sends nothing to the project or to anyone else. LG's own terms and privacy policy apply to the TV and to the LG Content Store.

## This website

torsher.app uses Google Analytics to count visits and see which pages people read. Google Analytics sets cookies in your browser and receives your IP address, browser and device details, the pages you open and the site you came from. Google processes this data under its own [privacy policy](https://policies.google.com/privacy). The project sees only aggregated reports and uses them to improve the site and the documentation. The site shows no advertising, and the analytics are not linked to any advertising product.

To opt out, block cookies for this site, use a content blocker or install the [Google Analytics opt-out add-on](https://tools.google.com/dlpage/gaoptout).

The site is served through Cloudflare, which processes visitors' IP addresses to deliver and protect the site under its own privacy policy.

## Contact

Questions about this policy: [GitHub Issues](https://github.com/torsher-app/torsher/issues).

Last updated: 2026-11-19.
