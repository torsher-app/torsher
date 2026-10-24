---
title: Network
description: "How the server reaches TMDB, indexers and managers: DNS over HTTPS, routes through your own proxy and spoofed DNS."
---

# Network

How the server reaches TMDB, indexers and managers: DNS over HTTPS, routes through your own proxy and spoofed DNS.

<Draft />

## What this page will cover

- The <Ui k="panel.settings.nav.network" /> page: which hosts the server checks and what each status means
- Spoofed DNS and how DNS over HTTPS fixes it
- Routes per host: direct, SOCKS5 or HTTP proxy
- Two Compose patterns for running your own proxy next to Torsher
- Torrent peers go direct
