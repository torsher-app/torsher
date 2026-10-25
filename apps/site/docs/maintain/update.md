---
title: Update and roll back
description: "How Torsher tells you about a new version, how to update it with Docker Compose, and how to go back if something breaks."
---

# Update and roll back

The container doesn't update itself. The panel tells you when a new version is out, and you update with two commands when nobody is watching.

::: tip What you'll get
Torsher on the new version with all your data, and a way back to the previous one.
:::

## How you learn about a new version

Once a day the server checks the project's releases on GitHub. When there is a newer one, <Ui k="panel.nav.overview" /> and <Ui k="panel.nav.settings panel.settings.nav.about" /> show that a new version is available, with the highlights of the release notes, <Ui k="panel.updates.whatsNew" /> and <Ui k="panel.updates.howTo" />. The request carries no data about you or the server.

In <Ui k="panel.nav.settings panel.settings.nav.about" />, under <Ui k="panel.updates.title" />:

- <Ui k="panel.updates.toggle" /> turns the check off. Then the server never contacts GitHub.
- <Ui k="panel.updates.channel" />: <Ui k="panel.updates.channels.stable" /> offers releases only. <Ui k="panel.updates.channels.beta" /> also offers pre-releases.
- <Ui k="panel.updates.check" /> checks right away.

<Ui k="panel.updates.dismiss" /> hides the notice on the overview until the next version comes out.

## Before you start

- A terminal on the server, in the folder with your `docker-compose.yml`.
- Nobody watching: the update restarts the server and stops playback on every device. <Ui k="panel.updates.howTo" /> warns you if someone is watching right now.

## 1. Check the image tag

The `image:` line in `docker-compose.yml` decides which version you get:

| Tag | What it follows |
| --- | --- |
| `ghcr.io/torsher-app/torsher:latest` | Stable releases. The install file uses it |
| `ghcr.io/torsher-app/torsher:beta` | Every release, pre-releases included |
| `ghcr.io/torsher-app/torsher:<version>` | One exact version, for example `0.3.0`. Change it to the new version by hand |

`<major>.<minor>` and `<major>` tags, such as `0.3`, follow the newest stable release in that line.

## 2. Pull the new image

```bash
docker compose pull
```

## 3. Restart on the new image

```bash
docker compose up -d
```

Docker replaces the container and keeps your volumes. The database, keys, downloads and library live in `/data` and the other mounted folders, not in the container.

::: details Not using Docker Compose
Stop and remove the container, run `docker pull` with the image name, and start it again with the same volumes, ports and environment variables as before.

Tools that update containers on their own work too. An update interrupts playback, so updating by hand when nobody is watching is safer.
:::

## The backup before an update

When a new version changes the database, the server first makes a backup with the reason <Ui k="panel.backups.list.reasons.pre-update" />, then changes the database. The last three such backups are kept. They are in the list under <Ui k="panel.nav.settings panel.settings.nav.backups" /> and in `torsher backups`.

If that backup fails, for example because the disk is full, the server doesn't change the database and doesn't start. The container log says why and what to do. Free up space or fix access to the backup folder and start it again. If you accept the risk, set `TORSHER_SKIP_PRE_UPDATE_BACKUP=1` for one start: without that backup, a failed update can't be undone.

## Check

- <Ui k="panel.nav.settings panel.settings.nav.about" /> shows the new number next to <Ui k="about.version" />, and the update check says the server is up to date.
- The container is `healthy` in `docker compose ps`.

## Roll back to the previous version

A database changed by a newer version doesn't start with an older one. To go back, run the old version on the backup made before the update.

1. Find the backup. Its name has `pre-update` in it:

   ```bash
   docker exec -it torsher torsher backups
   ```

2. In `docker-compose.yml`, set the image to the version you had before, for example `ghcr.io/torsher-app/torsher:0.2.0`, and pull it:

   ```bash
   docker compose pull
   ```

3. Prepare the restore with the old version. The server isn't running at this point, so use a one-off container:

   ```bash
   docker compose run --rm torsher torsher restore <backup-name>
   ```

4. Start Torsher. It restores the database first, then starts:

   ```bash
   docker compose up -d
   ```

::: warning
Everything changed after the backup was made is lost: new positions, ratings, settings. To keep that data, fix the problem on the new version instead, or [export](/docs/maintain/backup#move-data-into-another-server) what you need first.
:::

## If something went wrong

- **The container stops right after the update** and the log says `Could not back up the database before updating it`. See [the backup before an update](#the-backup-before-an-update).
- **The log says `The database was updated by a newer version of Torsher`.** You started an older version on a newer database. Start the newer version again, or [roll back](#roll-back-to-the-previous-version) with its `pre-update` backup.
- **The panel never shows a new version.** <Ui k="panel.nav.settings panel.settings.nav.about" /> shows why: the check is off, GitHub limited requests from your address, or the server can't reach GitHub. Requests to GitHub go through the routes in <Ui k="panel.nav.settings panel.settings.nav.network" />.

To read the container log, see [Logs and diagnostics](/docs/maintain/logs).

## Next

- [Backup and move](/docs/maintain/backup).
