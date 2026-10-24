---
title: Docker Compose
description: "Install Torsher with Docker Compose on Linux: the install file, one data volume or several disks, file ownership, starting, checking and updating."
---

# Docker Compose

Torsher is one container described in one `docker-compose.yml`. This page sets it up on a single disk or across several, and explains each line you may want to change.

::: tip What you'll get
Torsher running on your server, its data in a folder you chose, and the control panel open in your browser.
:::

<EarlyNotice />

## Before you start

- Docker with the Compose plugin: [Docker Engine](https://docs.docker.com/engine/install/) on Linux, or Docker Desktop on Windows and macOS. Check with `docker compose version`.
- Linux gets every feature. Docker Desktop runs Torsher with transcoding on the CPU only, and its file sharing may not keep hard links; see [Docker Desktop](/docs/install/docker-desktop).
- The commands on this page are for Linux and macOS.
- Disk space for what you watch and keep. See [Requirements](/docs/install/requirements).

## 1. Get the install file

```bash
mkdir torsher && cd torsher
curl -fsSL https://raw.githubusercontent.com/torsher-app/torsher/main/docker-compose.example.yml -o docker-compose.yml
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

Put `/data` on the largest disk, so downloads and the library sit on one volume. A kept file is then a hard link: it keeps seeding and takes no extra space.

```yaml
volumes:
  # Downloads and the library together, on the large disk
  - /mnt/storage/torsher:/data
  # Movies and series you already have, read-only
  - /mnt/media/movies:/media/movies:ro
  - /mnt/media/shows:/media/shows:ro
```

After the first start, add the read-only folders in the panel: <Ui k="panel.nav.library" />, then <Ui k="panel.library.add.title" />, with the path inside the container, for example `/media/movies`. Torsher indexes them in place and never writes there.

::: warning Keep downloads and the library in one volume
Do not mount `/data/torrents` and `/data/library` separately, even from the same disk: hard links don't cross volumes, and every kept file is copied and takes space twice. The setup wizard and the storage settings warn when this happens.
:::

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

```bash
docker compose pull && docker compose up -d
```

The database is migrated on start. Settings, the library and the watch history stay.

## If something went wrong

- **The container restarts.** Read the log: `docker compose logs torsher`.
- **The data folder is not writable.** `PUID` and `PGID` don't match the owner of the folder on the host. Fix them and run `docker compose up -d` again.
- **Port 8080 is taken.** Change the left side of the port mapping, for example `'8081:8080'`, and open the panel on that port.

More: [Troubleshooting](/docs/troubleshooting).

## Next

- [Hardware transcoding](/docs/install/hardware-acceleration), if the server has a GPU.
- [Setup wizard](/docs/setup/wizard).
