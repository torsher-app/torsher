---
title: Backup and move
description: "Daily database backups, backups on another disk, password protection, restoring, moving Torsher to a new server and merging data into another one."
---

# Backup and move

Torsher backs up its database every day on its own. This page explains what a backup holds, how to keep it away from the server's disk, how to restore it, and how to move your data to another server.

::: tip What you'll get
Backups on a disk that survives a failure of the server's disk, and a tested way back from one.
:::

## What a backup holds

A backup is one file with the database: the account, profiles, watch positions, ratings, lists, collections, sources and settings. It also holds the key that encrypts saved secrets (indexer API keys, proxy passwords, notification tokens), unless you protect backups with a password.

Videos, downloads, the cache and the log are not in it. Protect your library with disk or NAS snapshots or your own backup tool.

## Where to find backups

Everything on this page is in <Ui k="panel.nav.settings panel.settings.nav.backups" />. The same actions are available as commands in the container, for when the panel doesn't open.

## The schedule

By default, the server makes a backup once a day at 04:00 in the container's time zone (`TZ`) and keeps 7 daily and 4 weekly ones. Change it in the <Ui k="panel.backups.schedule.title" /> card:

- <Ui k="panel.backups.schedule.enabled" /> and <Ui k="panel.backups.schedule.time" />.
- <Ui k="panel.backups.schedule.keepDaily" />: from 1 to 30 days. <Ui k="panel.backups.schedule.keepWeekly" />: from 0 to 12 weeks. Old backups are removed only after a new one succeeds.

The server also makes a backup on its own before an update that changes the database, before every restore and before an import. The last three of each kind are kept.

To make one right now, select <Ui k="panel.backups.list.create" />, or run:

```bash
docker exec -it torsher torsher backup
```

## Keep backups on another disk

By default, backups are in `/data/db/backups`, next to the database. If that disk fails, they go with it. Keep them on a second disk or a NAS share:

1. Mount the folder into the container in `docker-compose.yml`, under `volumes:` of the `torsher` service:

   ```yaml
   - /mnt/nas/torsher-backups:/backups
   ```

   Replace `/mnt/nas/torsher-backups` with the folder on your server. It must exist and be writable by `PUID` and `PGID`.

2. Apply the change:

   ```bash
   docker compose up -d
   ```

3. In the <Ui k="panel.backups.dir.title" /> card, select <Ui k="panel.backups.dir.change" />, enter `/backups` and select <Ui k="panel.backups.dir.dialog.save" />. The dialog checks that the folder is writable and says whether it is on a different disk from the database.

If the folder becomes unavailable, for example the NAS is off, scheduled backups are skipped and the panel says so. Backups before an update or a restore then go to the default folder and are marked <Ui k="panel.backups.list.fallback" />.

Don't point several Torsher servers at the same backup folder.

You can also keep copies anywhere you like: <Ui k="panel.backups.list.download" /> in the menu of a backup saves the file to your computer.

## Protect backups with a password

In the <Ui k="panel.backups.encryption.title" /> card, choose how backups are protected:

- <Ui k="panel.backups.encryption.key" /> (default): a backup restores on any server without a password, but whoever has the file has your secrets and watch history too. Keep backups where strangers can't reach them.
- <Ui k="panel.backups.encryption.password" />: the whole file is encrypted with your password, at least 8 characters. On this server, scheduled backups and restores keep working without typing it.

::: warning The password can't be recovered
Without the password, backups made with it are useless on another server. Existing backups keep the password they were made with when you change or remove it.
:::

## Restore a backup

Restoring replaces all the server's data with the data from the backup. Everything changed since it was made is lost.

### In the panel

1. In the <Ui k="panel.backups.list.title" /> list, open the menu of a backup and select <Ui k="panel.backups.list.restore" />.
2. Enter the backup password if the dialog asks for it, and select <Ui k="panel.backups.restore.confirm" />.

The server backs up the current state first, restarts, swaps the database and comes back, usually in under a minute. Playback stops on every device. The restart needs `restart: unless-stopped`, as in the install file. Without it, start the container again with `docker compose up -d`, and the page carries on by itself.

A backup file from somewhere else? Select <Ui k="panel.backups.list.upload" /> first. Files up to 2 GB are accepted.

### With a command

When the panel doesn't open, list the backups and restore one by name:

```bash
docker exec -it torsher torsher backups
```

```bash
docker exec -it torsher torsher restore <backup-name>
```

```bash
docker restart torsher
```

A backup with a password needs it on standard input: add `--password-stdin` and pipe the password in, as in [Reset the password](/docs/maintain/reset-password).

### When the container doesn't start

`docker exec` doesn't work while the container is stopped or restarting. List the backups and run the restore in a one-off container, then start Torsher:

```bash
docker compose run --rm torsher torsher backups
```

```bash
docker compose run --rm torsher torsher restore <backup-name>
```

```bash
docker compose up -d
```

Instead of a name, you can pass the path to a backup file inside the container, for example a file you copied into `/data/db`.

## Move to a new server

A backup moves the whole server.

1. On the old server, select <Ui k="panel.backups.list.create" />, then <Ui k="panel.backups.list.download" /> in the menu of the new backup.
2. On the new server, [install Torsher](/docs/install/docker-compose) and open the panel.
3. On the account screen of the setup wizard, choose <Ui k="panel.backups.setup.link" />, select the file and enter its password if it has one.
4. Sign in with the old server's email and password.

Downloads and the library are not in the backup. Copy them yourself to the folders the new server uses, or let it download again what you need.

## Move data into another server

To bring profiles into a server that already has its own data, use an export. Unlike a restore, it merges and replaces nothing.

1. On the old server, in the <Ui k="panel.transfer.title" /> card, select <Ui k="panel.transfer.exportAction" />. Profiles, watch positions, Watchlist, Favorites, ratings and Dropped are always included. Choose what else to add: <Ui k="panel.transfer.export.collections" />, <Ui k="panel.transfer.export.libraries" />, <Ui k="panel.transfer.export.settings" />, and <Ui k="panel.transfer.export.secrets" /> with an export password. Select <Ui k="panel.transfer.export.submit" />.
2. On the other server, in the same card, select <Ui k="panel.transfer.importAction" /> and drop the file.
3. Choose where each profile goes: into a profile with the same name, into another one, into a new profile, or nowhere. Check the summary and select <Ui k="panel.transfer.import.submit" />.

The later watch position and rating win, lists and collections are combined, and the other server's settings are kept. Importing the same file twice changes nothing. Profile PINs, the account, devices, torrents and files are never exported.

The server makes a backup before the import, so <Ui k="panel.transfer.import.result.undo" /> can take it back.

One profile only: <Ui k="panel.imports.export" /> and <Ui k="panel.imports.start" /> in the profile card under <Ui k="panel.nav.people" />.

::: details From the command line
Export everything with libraries and settings:

```bash
docker exec torsher torsher export --libraries --settings > torsher-export.json
```

The file to import must be inside the container, for example copied into `/data/db`. Preview what will change:

```bash
docker exec -i torsher torsher import /data/db/torsher-export.json --dry-run
```

Run it again without `--dry-run` to apply. `--profile <name>` exports or imports one profile, `--password-stdin` reads the export password. After an import with settings or new folders, restart the container.
:::

## Check

- The <Ui k="panel.backups.list.title" /> list has a fresh backup, and the <Ui k="panel.backups.schedule.title" /> card shows when the next one is due.
- With a second disk, the <Ui k="panel.backups.dir.title" /> card doesn't warn that backups are on the same disk as the database.

## If something went wrong

- **<Ui k="panel.backups.errors.dir_unavailable" />.** The folder isn't mounted into the container or isn't writable by `PUID` and `PGID`. Check the `volumes:` line and the owner of the folder on the host.
- **Not enough space.** The backup needs free space for a copy of the database. Free up space on that disk or choose another folder.
- **<Ui k="panel.backups.errors.key_unavailable" />.** `TORSHER_SECRET` or `/data/db/secret.key` changed. Put the old key back, or set the backup password again.
- **After a restore, indexer keys or passwords are missing.** The backup was protected with a different `TORSHER_SECRET`, or made with a password elsewhere. Restore the old `TORSHER_SECRET` value or enter the keys again.
- **<Ui k="panel.backups.errors.newer_version" />.** [Update](/docs/maintain/update) this server, then restore.

## Next

- [Update and roll back](/docs/maintain/update).
- [Logs and diagnostics](/docs/maintain/logs).
