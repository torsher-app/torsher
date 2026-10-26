---
title: Docker Desktop
description: "Run Torsher on Windows or macOS with Docker Desktop: what works and what doesn't, where to keep the data, and how a TV reaches it."
---

# Docker Desktop

Docker Desktop runs Linux containers on Windows and macOS, so Torsher runs there too. It's a good way to try Torsher on the computer you already have. For a server that runs all the time, a Linux machine gets every feature: see [Mini PC](/docs/install/mini-pc).

::: tip What you'll get
Torsher running in Docker Desktop, its data in a Docker volume, and the showcase open on your TV.
:::

## What works and what doesn't

Docker Desktop is supported on a best-effort basis: the image is built for it and bug reports are welcome, but it gets no guarantees.

| | On Docker Desktop |
| --- | --- |
| Catalog, streaming, library, following | Work as on Linux |
| Hardware transcoding | No: Docker Desktop doesn't pass a GPU into Linux containers. The CPU transcodes and scales large video down |
| Data in a folder on your computer | Not checked yet: hard links and the database may not work on shared folders. Use a Docker volume, as below |
| Running all the time | Only while the computer is awake and Docker Desktop is running |

## Before you start

- Docker Desktop, installed by Docker's guide: [Windows](https://docs.docker.com/desktop/setup/install/windows-install/) (with the WSL 2 backend) or [Mac](https://docs.docker.com/desktop/setup/install/mac-install/). The image runs on both Intel and Apple silicon Macs.
- Docker Desktop started. Check in a terminal (Terminal on macOS, PowerShell on Windows):

  ```bash
  docker compose version
  ```

- Disk space for what you watch and keep. See [Requirements](/docs/install/requirements).

## 1. Get the install file

1. Create a folder, for example `torsher` in your home folder.
2. Download [docker-compose.yml](https://github.com/torsher-app/torsher/releases/latest/download/docker-compose.yml) from the latest release into it.

What each line means: [Docker Compose](/docs/install/docker-compose#_1-get-the-install-file).

## 2. Keep the data in a Docker volume

In `docker-compose.yml`, under `volumes:` of the `torsher` service, replace the `- ./data:/data` line with a named volume:

```yaml
- torsher-data:/data
```

Then add these lines at the very end of the file, without indentation:

```yaml
volumes:
  torsher-data:
```

The volume lives on the Linux disk inside Docker Desktop, not in a folder shared from Windows or macOS, so the database and hard links should behave as on Linux (not tested on Docker Desktop yet). The files in it are not visible in Finder or File Explorer.

`PUID` and `PGID` can stay at `1000`: on start, the container gives its folders in the volume to that user.

::: details Keep the data in a folder on your computer instead
Leave `./data:/data` as it is. Torsher then keeps everything in the `data` folder next to `docker-compose.yml`. This setup is not checked yet: the database and hard links may misbehave on folders shared from Windows or macOS. If the folder browser in the panel says files will be copied, kept files take space twice.

On macOS, Docker Desktop shares `/Users`, `/Volumes`, `/private`, `/tmp` and `/var/folders` by default; other folders have to be added in its settings first.
:::

To let Torsher see movies you already have, add the folder read-only under `volumes:` of the `torsher` service. On macOS:

```yaml
- /Users/<you>/Movies:/media/movies:ro
```

On Windows:

```yaml
- C:/Users/<you>/Videos:/media/movies:ro
```

After the first start, add `/media/movies` under <Ui k="panel.nav.library" />, then <Ui k="panel.library.add.title" />. Torsher never writes there.

## 3. Start

In a terminal, in the folder with `docker-compose.yml`:

```bash
docker compose up -d
```

To run Prowlarr next to it, see [Indexers](/docs/setup/indexers).

## 4. Open the panel

On the same computer, open `http://localhost:8080/panel/`. The panel asks you to create the owner account and starts the [setup wizard](/docs/setup/wizard).

## 5. Reach it from the TV

Docker Desktop publishes the port on all network interfaces of the computer by default, so a TV in the same network opens Torsher at the computer's address: `http://<server-address>:8080/`.

- **Windows:** run `ipconfig` and take the **IPv4 Address** of your network adapter.
- **macOS:** System Settings → Network shows the address of the active connection.

A firewall on the computer may block connections from the TV. If the TV can't reach Torsher, allow incoming connections for Docker Desktop in the firewall.

To keep Torsher available, keep the computer from sleeping and turn on **Start Docker Desktop when you sign in to your computer** in Docker Desktop's settings; it's off by default. The container starts again with Docker Desktop thanks to `restart: unless-stopped` in the install file.

## Check

1. In the folder with `docker-compose.yml`, run:

   ```bash
   docker compose ps
   ```

   The `torsher` container should be `running`, and within a minute `healthy`.

2. On your phone, open `http://<server-address>:8080/panel/`. If it opens, the TV will reach the server too.
3. In the panel, <Ui k="panel.nav.settings panel.settings.nav.playback" /> says <Ui k="panel.settings.playback.noGpu" />, which is expected here, and <Ui k="panel.settings.playback.transcode.title" /> shows what the CPU can handle.

## If something went wrong

- **`docker` is not found or can't connect.** Docker Desktop isn't running. Start it, wait until it has started, and try again.
- **The container keeps restarting.** See [Troubleshooting](/docs/troubleshooting#container-restarts).
- **Port 8080 is taken.** See [Troubleshooting](/docs/troubleshooting#port-in-use).
- **The TV or phone doesn't reach the server.** Check the address and the firewall. See [Troubleshooting](/docs/troubleshooting#panel-unreachable).
- **Kept files are copied.** See [Troubleshooting](/docs/troubleshooting#copies).

## Next

- [Setup wizard](/docs/setup/wizard).
- [Connect a device](/docs/tv/connect).
