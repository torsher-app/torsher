---
title: Requirements
description: "What Torsher runs on: CPU architectures, memory, disks, GPUs for transcoding, the network and supported TVs, with the support level for each."
---

# Requirements

Torsher runs as one Linux container. Almost any computer that runs Docker will do; this page tells you how well it will do.

::: tip What you'll learn
Whether your hardware is supported, how much disk you need, and which TVs and browsers work.
:::

## Support levels

| Level | What it means | Platforms |
| --- | --- | --- |
| **Supported** | Tested before every release, fixed first | x86-64 Linux, including NAS on x86 (Unraid, TrueNAS SCALE, Synology and QNAP with Intel CPUs) |
| **Best effort** | Built and accepted in bug reports, without guarantees | arm64 Linux (Raspberry Pi 5, RK3588 boards), Docker Desktop on macOS and Windows |
| **Not supported** | No image | 32-bit ARM, Synology models with Realtek ARM CPUs, Windows without Docker |

## Server

- **CPU:** x86-64 or arm64. An Intel N100 or N150 mini PC is a good reference: it plays everything and transcodes on its built-in GPU.
- **Memory:** 4 GB or more.
- **GPU (optional):** Intel or AMD graphics through VAAPI, or an NVIDIA card through NVENC. Without one, the CPU transcodes and scales large video down. See [Hardware transcoding](/docs/install/hardware-acceleration).
- **Docker:** Docker Engine with the Compose plugin. See [Docker Compose](/docs/install/docker-compose).

On a Raspberry Pi 4 and similar boards, the CPU is too slow to transcode: files the TV plays directly work, the rest may not.

## Disks

- **The data volume** holds the database, the watch cache and the library. Plan for the cache (it cleans itself up when it reaches the limit) plus everything you keep.
- **Downloads and the library on one volume.** Kept files are hard-linked from downloads into the library and take no extra space. On different volumes they are copied. See [Docker Compose](/docs/install/docker-compose#several-disks).
- **Your existing media** can stay where it is: Torsher reads those folders and never writes there.

## Network

- One port for the web interface and the API, `8080` by default.
- The server needs internet access to TMDB, your indexers and torrent peers. If your provider spoofs DNS or blocks hosts, Torsher can use DNS over HTTPS and your own proxy. See [Network](/docs/setup/network).
- Opening a port for incoming peer connections is optional and improves download speed.

## TVs and browsers

| Client | Status |
| --- | --- |
| LG webOS app | Tested on LG C4 (2024). TVs from 2020 (webOS 5) and later are targeted, but not tested yet |
| Browser on a computer | Current Chrome, Edge, Firefox and Safari. The server converts what a browser can't play |
| Browser on a TV | Works if the TV browser is recent enough |
| Android TV, Apple TV, phones | Planned. See [Other devices](/docs/tv/other-devices) |
