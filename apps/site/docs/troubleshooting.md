---
title: Troubleshooting
description: "Fixes for common problems: the container doesn't start, folder permissions, disk space, hard links, TMDB access and keys, indexers, playback, TVs and backups."
---

# Troubleshooting

Find the message you see, or the closest description, and follow the steps under it. The setup wizard and <Ui k="panel.overview.attention.title" /> on the <Ui k="panel.nav.overview" /> page use the same checks as this page.

When nothing here matches, read the log: [Logs and diagnostics](/docs/maintain/logs).

## The server doesn't start

### The container keeps restarting {#container-restarts}

Read why it stops:

```bash
docker compose logs --tail 100 torsher
```

The last lines name the reason. The common ones are below.

### `… is not writable by …` {#not-writable}

The container log says `/data/db is not writable by 1000:1000` or the same about the downloads or library folder. The wizard shows <Ui k="panel.wizard.storage.data.readonly" />, <Ui k="panel.wizard.storage.downloads.readonly" /> or <Ui k="panel.wizard.storage.library.readonly" />.

Torsher writes files as the user in `PUID` and `PGID`, and that user doesn't own the folder on the host.

1. Find the owner of the folder on the host:

   ```bash
   ls -ln <folder-on-host>
   ```

   The third and fourth columns are the user and group IDs.

2. Set `PUID` and `PGID` in `docker-compose.yml` to those numbers, or give the folder to your user:

   ```bash
   sudo chown -R <uid>:<gid> <folder-on-host>
   ```

3. Apply the change:

   ```bash
   docker compose up -d
   ```

If the container runs as a fixed user (`user:` in `docker-compose.yml`, or a NAS app catalog that sets it), `PUID` and `PGID` don't apply, and the message says so. Give the user from the message write access to the folder instead, with the `chown` command above and the numbers from the message.

`PUID and PGID must be numeric` means one of them has letters or spaces in it.

### `SECRET_KEY` is too short {#secret-key}

If you set `SECRET_KEY`, it must be a random string of at least 32 characters. Generate one with `openssl rand -hex 32`, or remove the variable: Torsher then keeps its own key in `/data/db/session.key`.

### `Could not back up the database before updating it` {#pre-update-backup}

A new version wants to change the database and couldn't back it up first. See [Update and roll back](/docs/maintain/update#the-backup-before-an-update).

### `The database was updated by a newer version of Torsher` {#newer-database}

You started an older version on a database a newer one already changed. Start the newer version again, or [roll back with its backup](/docs/maintain/update#roll-back-to-the-previous-version).

### Port 8080 is already in use {#port-in-use}

Another program uses the port. Change the left side of the port mapping in `docker-compose.yml`, for example `'8081:8080'`, run `docker compose up -d` and open the panel on the new port.

### The panel doesn't open from another device {#panel-unreachable}

- Check that the container is `healthy` in `docker compose ps`.
- Open `http://<server-address>:8080/api/health` on that device. If it doesn't load, the device doesn't reach the server: check the address (on Linux, `hostname -I` on the server), that both are in the same network, and the server's firewall.
- On the server itself, `http://localhost:8080/panel/` should open. If it does there but not elsewhere, it's the network or the firewall.

## Storage

### Not enough free space {#low-space}

The wizard says the cache limit won't fit or free space is less than the reserve. <Ui k="panel.overview.attention.title" /> says free space is below the reserve or torrents are paused for lack of space. The player says <Ui k="player.errors.storage.no_space.title" />.

Below the reserve, new playback doesn't start and downloads pause. In <Ui k="panel.nav.settings panel.settings.nav.storage" />:

- lower <Ui k="panel.settings.storage.cacheTitle" />, so Torsher removes older cache items sooner;
- or lower <Ui k="panel.settings.storage.reserveTitle" />, if the disk really has room to spare;
- or free up space on the disk: delete downloads you don't need in <Ui k="panel.nav.torrents" />.

Downloads resume on their own once there is space. Items you keep or watch right now are never removed to make room.

### The file doesn't fit in the cache {#cache-limit}

The player says <Ui k="player.errors.storage.cache_limit.title" />: the file is bigger than what is left of the cache limit. Raise <Ui k="panel.settings.storage.cacheTitle" /> in <Ui k="panel.nav.settings panel.settings.nav.storage" />.

### Kept files are copied instead of hard-linked {#copies}

The wizard says <Ui k="panel.wizard.storage.links.copy" />, and <Ui k="panel.overview.attention.title" /> repeats it.

A kept file is normally hard-linked from downloads into the library: it keeps seeding and takes no extra space. That only works inside one mounted volume. Two volumes, even on the same disk, turn every kept file into a copy.

Mount one folder for both and choose its subfolders in <Ui k="panel.nav.settings panel.settings.nav.storage" />, card <Ui k="panel.settings.storage.folders.title" />: `/data/torrents` and `/data/library` on one disk, or `/storage/torrents` and `/storage/library` with a [second disk](/docs/install/docker-compose#several-disks).

### A library folder is unavailable {#library-offline}

A connected folder shows <Ui k="panel.library.status.offline" />: <Ui k="panel.library.statusText.offline" />

Check that the disk is connected and that the folder is still mounted in `docker-compose.yml` under the same path inside the container.

### Releases are not recognized {#unmatched}

Files in a connected folder that Torsher couldn't match to a title are under <Ui k="panel.library.unmatched.title" /> in <Ui k="panel.nav.library" />. Pick the title for them there; until then they show up under “No description” on the showcase.

A download that Torsher couldn't match waits under <Ui k="home.rows.libraryUnmatched" /> on the showcase and can't go to the library yet. Pick its title there, or with <Ui k="panel.torrents.match.fix" /> in <Ui k="panel.nav.torrents" />. See [Library](/docs/watch/library).

## Network and TMDB

The catalog, posters and descriptions come from TMDB. The wizard's <Ui k="panel.wizard.network.title" /> step and <Ui k="panel.nav.settings panel.settings.nav.network" /> check that the server reaches <Ui k="panel.wizard.network.hosts.tmdb" /> and <Ui k="panel.wizard.network.hosts.tmdb_images" />.

### DNS returns a wrong address {#dns-spoofing}

Some networks answer DNS requests for some sites with a wrong address, so the server can't reach them. Torsher notices it and says that DNS returns a wrong address.

In <Ui k="panel.nav.settings panel.settings.nav.network" />, choose DNS over HTTPS in the <Ui k="panel.settings.network.dnsCard.title" /> card and save it. In the wizard, select <Ui k="panel.wizard.checks.retry" /> afterwards. If one DoH provider doesn't work, choose another. See [Network](/docs/setup/network).

### A host is unreachable {#host-unreachable}

The server can't connect to it at all. Check the server's internet connection first. If the site is unreachable from your network, add a route for its host through your proxy in <Ui k="panel.nav.settings panel.settings.nav.network" />. See [Network](/docs/setup/network).

### No TMDB key {#tmdb-key-missing}

The wizard says <Ui k="panel.wizard.network.key.missing" />. The image you run has no built-in TMDB key, for example a local build. The showcase says <Ui k="state.notConfigured.title" />. Add your own key in <Ui k="panel.nav.settings panel.settings.nav.metadata" />. See [TMDB key](/docs/setup/tmdb).

### TMDB rejects the key {#tmdb-key-rejected}

The wizard says <Ui k="panel.wizard.network.key.rejected" />. The key was mistyped or revoked. Copy it again without spaces, or use the other of the two values on the TMDB API page. See [TMDB key](/docs/setup/tmdb).

If <Ui k="panel.overview.attention.title" /> says the saved key can't be decrypted, `TORSHER_SECRET` or `/data/db/secret.key` changed since you saved it. Enter the key again.

### The showcase says TMDB is unavailable {#tmdb-unavailable}

The showcase shows <Ui k="state.unavailable.title" />: the server doesn't reach TMDB. Go through [DNS returns a wrong address](#dns-spoofing) and [A host is unreachable](#host-unreachable).

## Sources

### Prowlarr or Jackett not found {#manager-not-found}

The wizard says <Ui k="panel.wizard.sources.notFound" />. It looks for Prowlarr and Jackett as compose services named `prowlarr` and `jackett`, on the Docker host, at the container network gateway and on this machine, on ports 9696 and 9117.

- The manager runs at another address or port: connect it with <Ui k="panel.wizard.sources.none.importTitle" />. Use the address as the Torsher server sees it: `localhost` inside the container is the container itself.
- You have no manager yet: start Prowlarr from the install file and add the indexers you are allowed to use. See [Indexers](/docs/setup/indexers).

### An indexer doesn't respond or rejects requests {#indexer-error}

<Ui k="panel.nav.sources" /> marks the indexer under <Ui k="panel.sources.groups.attention" /> and says why:

- **The API key is rejected.** An indexer from Prowlarr or Jackett uses the manager's own API key, so the key was most likely changed in the manager. Copy the current key from it and enter it in Torsher: the menu next to the manager's name → <Ui k="panel.sources.managers.changeKey" />. For an indexer added by hand, enter the new key with <Ui k="panel.sources.indexers.edit" />.
- **It doesn't respond in time.** Search goes through the other indexers meanwhile. If the site is unreachable from your network, add a route through your proxy in [Network](/docs/setup/network).
- **It is gone from the manager.** It was removed in Prowlarr or Jackett, and Torsher doesn't search it. Add it back in the manager and sync, or delete it if you don't need it.

### Search finds nothing {#nothing-found}

- Check that <Ui k="panel.nav.sources" /> has at least one working indexer.
- The <Ui k="sources.title" /> screen on the TV says how many indexers didn't answer.
- Your indexers may simply have nothing for this title. Torsher searches only the sources you connected.

## Playback

### Playback waits for peers {#waiting-for-peers}

The player shows <Ui k="player.steps.waitingPeers" />: <Ui k="player.waitingHint" /> In the panel, the download says <Ui k="panel.torrents.problems.stalled" />

Choose another release with more seeders on the <Ui k="sources.title" /> screen. If every release waits, check that the server reaches the internet.

### The torrent isn't ready or has no file list {#no-file-list}

<Ui k="player.errors.notReady.title" />: the server is still getting the file list from peers. Try again in a minute. If the panel says <Ui k="panel.torrents.problems.failed" />, choose another release.

### The video doesn't play {#unsupported}

The player says <Ui k="player.errors.unsupported.title" />: the device can't decode this video and the server couldn't transcode it. Open <Ui k="panel.nav.settings panel.settings.nav.playback" />: it shows what the server can transcode with. See [Hardware transcoding](/docs/install/hardware-acceleration). If the page says <Ui k="panel.settings.playback.unavailable.title" />, the server can't transcode at all: pick another release in a format the device plays.

### A GPU was found but failed the test {#gpu-failed}

The server transcodes on the CPU instead. See [Hardware transcoding](/docs/install/hardware-acceleration#if-something-went-wrong).

### The torrent engine isn't running {#engine}

The player says <Ui k="player.errors.engine.stopped.title" />, or <Ui k="panel.overview.attention.title" /> says the engine crashed. Restart the container:

```bash
docker compose restart torsher
```

If it keeps crashing, look for <Ui k="panel.logs.sources.engine" /> entries in <Ui k="panel.nav.logs" /> and [report it](/docs/maintain/logs#what-to-put-in-a-bug-report).

## TVs and devices

### The TV doesn't show a code {#tv-no-code}

The TV shows <Ui k="connect.error" />: it doesn't reach the server. Check that the server is running and that the TV is in the same network, then open `http://<server-address>:8080/api/health` in the TV's browser. If it doesn't load, the TV can't reach the server at that address.

### The code is not accepted {#code-rejected}

The code changes on its own after a while. Enter the one the TV shows right now. See [Connect a device](/docs/tv/connect).

### A device says it is not connected {#not-connected}

The showcase shows <Ui k="state.unauthorized.title" />. The device was removed in <Ui k="panel.nav.people" />, or the browser on it lost its site data. Connect it again with a new code.

## Backups

### The backup folder is unavailable {#backup-folder}

The disk or NAS share isn't mounted into the container, or isn't writable by `PUID` and `PGID`. Scheduled backups are skipped until it is back. See [Backup and move](/docs/maintain/backup#keep-backups-on-another-disk).

### No backup for more than two days {#backup-stale}

Scheduled backups are failing or off. <Ui k="panel.nav.settings panel.settings.nav.backups" /> shows the last error. Fix it, then select <Ui k="panel.backups.list.create" /> to check.

## Still stuck

Collect the version, the log and the steps, and [report the problem](/docs/maintain/logs#what-to-put-in-a-bug-report).
