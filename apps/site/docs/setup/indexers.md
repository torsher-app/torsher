---
title: Indexers
description: "Connect a Torznab indexer to Torsher: start Prowlarr from the install file, import all indexers from Prowlarr or Jackett, or add one Torznab indexer by address."
---

# Indexers

Torsher ships with no sources. Prowlarr and Jackett manage connections to the indexers you choose. Both start with no configured sources: you add and set them up yourself.

Torznab is an API for searching torrent indexers, not a separate app to install. Both Prowlarr and Jackett provide this API for the indexers you configure. Torsher can also connect to a Torznab endpoint directly.

First configure and test your indexers in your manager, then connect it to Torsher using its address and API key. After changing indexers in the manager, sync it in Torsher to update the imported list.

::: tip What you'll get
An indexer manager connected to Torsher, and releases appearing when you select <Ui k="title.watch" />.
:::

## Before you start

- Torsher is running. See [Docker Compose](/docs/install/docker-compose).
- You know which sources you are allowed to use. Torsher does not include or recommend any.

## Option A: Prowlarr next to Torsher

The install file already has Prowlarr as an optional service. Skip to [Option B](#option-b-a-manager-you-already-run) if you already run Prowlarr or Jackett.

1. Start it in the folder with `docker-compose.yml`:

   ```bash
   docker compose --profile prowlarr up -d
   ```

2. Open `http://<server-address>:9696`. On the first visit Prowlarr may ask you to set up its own sign-in.
3. In Prowlarr, open **Indexers** and add the torrent indexers you are allowed to use. Test each one in Prowlarr and save it before connecting to Torsher.
4. Copy the API key from **Settings → General → API Key** in Prowlarr.
5. In the Torsher setup wizard, the <Ui k="panel.wizard.steps.sources.title" /> step finds Prowlarr at `http://prowlarr:9696` by itself. Paste the API key and select <Ui k="panel.wizard.sources.connect.submit" />.

Already past the wizard? Use Option B with the address `http://prowlarr:9696`.

## Option B: a manager you already run

Configure and test your torrent indexers in Prowlarr or Jackett before importing them into Torsher.

1. Find the API key:
   - Prowlarr: **Settings → General → API Key**;
   - Jackett: the **API Key** field at the top of the dashboard.
2. In the Torsher panel, open <Ui k="panel.nav.sources" /> and select <Ui k="panel.sources.import" />.
3. Choose the manager and enter the address and the API key.

   The address is how the **Torsher server** reaches the manager, not your computer:

   | Where the manager runs               | Address                                                                      |
   | ------------------------------------ | ---------------------------------------------------------------------------- |
   | In the same `docker-compose.yml`     | `http://prowlarr:9696` or `http://jackett:9117`                              |
   | On the same machine, outside Compose | `http://<server-address>:9696` or `http://<server-address>:9117`             |
   | On another machine                   | `http://<that-machine-address>:9696` or `http://<that-machine-address>:9117` |

   For Jackett you can paste the address straight from your browser, such as `http://<server-address>:9117/UI/Dashboard`, or the Torznab feed address Jackett copies for an indexer: Torsher keeps the part before `/UI` or `/api`. If Jackett runs under a base path, it stays in the address: `http://<server-address>:9117/jackett`.

   For Prowlarr you can paste the address straight from your browser on any Prowlarr page, such as `http://<server-address>:9696/settings/general`, or an indexer's Torznab feed address: Torsher keeps the part before the page or `/api`. If Prowlarr runs under a URL base, it stays in the address: `http://<server-address>:9696/prowlarr`.

4. Select <Ui k="panel.sources.importDialog.submit" />. Torsher adds the manager's configured torrent indexers. With none configured, Torsher connects the manager and adds nothing until you configure indexers there and sync.

Torsher doesn't watch the manager by itself. When you add or remove indexers there, open <Ui k="panel.nav.sources" /> and use the sync button on the manager's card: new indexers are added, and ones gone from the manager are marked rather than deleted.

## Option C: one Torznab indexer

For an indexer that isn't in a manager, open <Ui k="panel.nav.sources" />, select <Ui k="panel.sources.add" /> and enter its <Ui k="panel.sources.addDialog.url" /> and <Ui k="panel.sources.addDialog.apiKey" />. The server checks the indexer before saving it.

### Session cookie for a Torznab endpoint

If your Torznab endpoint requires your session cookie, fill in the field when adding the indexer or in its <Ui k="panel.sources.indexers.edit" /> dialog: <Ui k="panel.sources.cookie.label" />. Enter only the `name=value; other=value` pairs from the request Cookie header. This also works for indexers imported from a manager; their name, address and API key stay managed there.

Torsher stores the cookie encrypted and never sends it back to the panel. Leave the field empty to keep the saved value, replace it by entering a new one, or select <Ui k="panel.sources.cookie.remove" /> and save to remove it. A cookie is included in a settings export only when you protect the export with a password.

The cookie is sent for capabilities, search, the feed and torrent downloads only at the configured Torznab origin: the same scheme, host and port. Redirecting to another origin drops it. An endpoint that redirects from HTTP to HTTPS needs its HTTPS address configured before saving the cookie.

The access check confirms that the capabilities request works now. A request Cookie header does not specify when the session expires; replace the cookie if access is rejected. This field does not add support for searching an ordinary website, browser challenges or automatic sign-in.

## Releases in other languages

Most indexers name releases in the scene format, such as `Show.Name.S01E02.1080p.WEB-DL.x265-GROUP`, whatever the language of the film. Torsher reads this format fully: title, year, season and episode, quality, source, codec and audio.

Russian-language indexers use their own format, with the Russian and original titles, episode ranges and the voice-over in the release title. Torsher reads it too, including voice-over studios and types: the <Ui k="sources.title" /> screen shows the voice-over of each release, and <Ui k="sources.panel.voice" /> filters by it.

Releases named in other languages work in part:

- Season, episode and quality markers in the scene format are read whatever the language. Words like "season" and "episodes" are read only in English and Russian.
- Language codes such as `GER`, `FRE` or `SPA` are recognized: with the server's audio language set to that language, releases with the track come first on the <Ui k="sources.title" /> screen. Local voice-over markers and studios are not, so the voice-over filter, which is for Russian, doesn't sort these releases.
- Torsher searches by IMDb, TMDB or TVDB ID when the indexer supports it, and by the original, English, Russian and Ukrainian titles from TMDB. A release named only by its title in another language, for example German or French, may not show up: select <Ui k="sources.query.action" /> on the <Ui k="sources.title" /> screen and enter the title the way the indexer names it.

## Check

Open any title on the TV and select <Ui k="title.watch" />. The <Ui k="sources.title" /> screen lists releases from your indexers. <Ui k="panel.nav.sources" /> in the panel shows each indexer with its status.

## If something went wrong

- **<Ui k="panel.wizard.sources.notFound" />.** The manager runs at another address or port: connect it by address as in Option B.
- **The import fails.** Check the address from the Torsher server's point of view and the API key.
- **<Ui k="panel.sources.errorTitles.loopback" />.** `localhost`, `127.0.0.1` and `0.0.0.0` point at the Torsher container itself, not at your machine. Use an address from the table in [Option B](#option-b-a-manager-you-already-run). If Torsher runs without Docker or with `network_mode: host`, `localhost` works and this message doesn't appear.
- **<Ui k="panel.sources.errorTitles.mdns" />.** Names such as `raspberrypi.local` usually don't resolve inside Docker. Use the IP address of that machine.
- **Jackett runs outside Docker and the server can't reach it.** On Windows and macOS Jackett accepts only connections from the same computer by default. In the Jackett dashboard, turn on **External access** and select **Apply server settings**.
- **The import adds no indexers.** The manager has none configured. Add indexers in it, then use the sync button on the manager's card.
- **Some indexers are not responding.** The <Ui k="sources.title" /> screen says how many didn't answer; the others are searched anyway. Check them in the manager. If the server can't reach a site directly, add a route through your proxy in [Network](/docs/setup/network).

## Next

[TMDB key](/docs/setup/tmdb), if the catalog is empty, or [Connect a device](/docs/tv/connect).
