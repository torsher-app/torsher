---
title: Docker Compose
description: "Install Torsher with Docker Compose on Linux: the install file, one data volume or several disks, file ownership, starting, checking and updating."
---

# Docker Compose

Torsher is one container described in one `docker-compose.yml`. This page sets it up on a single disk or across several, and explains each line you may want to change.

::: tip What you'll get
Torsher running on your server, its data in a folder you chose, and the control panel open in your browser.
:::

## Before you start

- Docker with the Compose plugin: [Docker Engine](https://docs.docker.com/engine/install/) on Linux, or Docker Desktop on Windows and macOS. Check with `docker compose version`.
- Linux gets every feature. Docker Desktop runs Torsher with transcoding on the CPU only, and its file sharing may not keep hard links; see [Docker Desktop](/docs/install/docker-desktop).
- The commands on this page are for Linux and macOS.
- Disk space for what you watch and keep. See [Requirements](/docs/install/requirements).

## 1. Get the install file

```bash
mkdir torsher && cd torsher
curl -fsSL https://github.com/torsher-app/torsher/releases/latest/download/docker-compose.yml -o docker-compose.yml
```

This is the whole file. Lines starting with `#` are optional and stay off until you remove the `#`:

<<< @/../../docker-compose.example.yml{yaml}

## 2. Set the file owner

Torsher writes files as the user in `PUID` and `PGID`. Find your IDs:

```bash
id -u && id -g
```

If they are not `1000` and `1000`, change `PUID` and `PGID` in `docker-compose.yml`. Use the same values for Prowlarr.

Set `TZ` to your time zone, for example `Europe/Berlin`, so schedules and logs show your local time.

## 3. Choose where data lives

### One disk

The default is fine for most setups: everything lives in `./data` next to `docker-compose.yml`.

```yaml
volumes:
  - ./data:/data
```

Inside, Torsher creates:

| Folder | What's inside |
| --- | --- |
| `/data/db` | The database, the key files `secret.key` and `session.key`, and the log. Back this up |
| `/data/torrents` | Downloads: the watch cache and what is still downloading |
| `/data/library` | What you keep, laid out by title so Jellyfin, Plex and Kodi can read it too |

### Several disks

Keep `/data` on the system disk for the database, and mount the big disk once more as its own volume:

```yaml
volumes:
  # Database and keys, on the system disk
  - ./data:/data
  # The big disk: downloads and the library together
  - /mnt/big:/storage
  # Movies and series you already have, read-only
  - /mnt/media/movies:/media/movies:ro
```

After the first start, choose the folders in the panel under <Ui k="panel.nav.settings panel.settings.nav.storage" />, card <Ui k="panel.settings.storage.folders.title" /> (the setup wizard shows the same card): `/storage/torrents` for <Ui k="panel.settings.storage.folders.downloads" /> and `/storage/library` for <Ui k="panel.settings.storage.folders.library" />. The folder browser shows free space and whether hard links work between the two.

Add the read-only folders under <Ui k="panel.nav.library" />, then <Ui k="panel.library.add.title" />, with the path inside the container, for example `/media/movies`. Torsher indexes them in place and never writes there.

::: warning Keep downloads and the library in one volume
Put both folders inside the same mounted volume, as `/storage` above. Two volumes, even on the same disk, block hard links: every kept file is copied and takes space twice. The folder browser and the storage settings warn when this happens.
:::

When a folder already holds data, the panel asks whether to send only new files to the new folder or move everything there in the background.

## 4. Start

Torsher alone:

```bash
docker compose up -d
```

Or Torsher with Prowlarr, if you don't run an indexer yet. See [Indexers](/docs/setup/indexers).

```bash
docker compose --profile prowlarr up -d
```

## 5. Check that it works

```bash
docker compose ps
```

The `torsher` container should be `running`, and within a minute `healthy`. Then open `http://<server-address>:8080/panel/` in a browser. The address of the server in your network, on Linux:

```bash
hostname -I
```

On the machine itself, `http://localhost:8080/panel/` works too.

The panel asks you to create the owner account and starts the [setup wizard](/docs/setup/wizard).

## Update

When a new version is out, the panel shows it on <Ui k="panel.nav.overview" /> and under <Ui k="panel.nav.settings panel.settings.nav.about" />. To update, run in the folder with `docker-compose.yml`:

```bash
docker compose pull
```

```bash
docker compose up -d
```

Settings, the library and the watch history stay. Before an update that changes the database, the server makes a backup of it first. Details: [Update and roll back](/docs/maintain/update).

## If something went wrong

- **The container restarts.** Read the log: `docker compose logs torsher`.
- **The data folder is not writable.** `PUID` and `PGID` don't match the owner of the folder on the host. Fix them and run `docker compose up -d` again.
- **Port 8080 is taken.** Change the left side of the port mapping, for example `'8081:8080'`, and open the panel on that port.
- **Downloading the image is very slow or stalls.** The same image is on Docker Hub: change `image:` in `docker-compose.yml` to `torsherapp/torsher:latest` and run `docker compose up -d` again. See [the image tag](/docs/maintain/update#_1-check-the-image-tag).

More: [Troubleshooting](/docs/troubleshooting).

## Next

- [Hardware transcoding](/docs/install/hardware-acceleration), if the server has a GPU.
- [Setup wizard](/docs/setup/wizard).
