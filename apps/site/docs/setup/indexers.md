---
title: Indexers
description: "Connect a Torznab indexer to Torsher: start Prowlarr from the install file, import all indexers from Prowlarr or Jackett, or add one Torznab indexer by address."
---

# Indexers

Torsher ships with no sources. It finds releases through Torznab indexers that you run and fill yourself: any Torznab indexer works, for example Prowlarr or Jackett. Connect a manager once, and Torsher picks up all its indexers; when you change them in the manager, sync it in the panel.

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
3. In Prowlarr, open **Indexers** and add the indexers you are allowed to use. Prowlarr starts empty.
4. Copy the API key from **Settings → General → API Key** in Prowlarr.
5. In the Torsher setup wizard, the <Ui k="panel.wizard.steps.sources.title" /> step finds Prowlarr at `http://prowlarr:9696` by itself. Paste the API key and select <Ui k="panel.wizard.sources.connect.submit" />.

Already past the wizard? Use Option B with the address `http://prowlarr:9696`.

## Option B: a manager you already run

1. Find the API key:
   - Prowlarr: **Settings → General → API Key**;
   - Jackett: the **API Key** field at the top of the dashboard.
2. In the Torsher panel, open <Ui k="panel.nav.sources" /> and select <Ui k="panel.sources.import" />.
3. Choose the manager and enter the address and the API key.

   The address is how the **Torsher server** reaches the manager, not your computer:

   | Where the manager runs | Address |
   | --- | --- |
   | In the same `docker-compose.yml` | `http://prowlarr:9696` or `http://jackett:9117` |
   | On the same machine, outside Compose | `http://<server-address>:9696` |
   | On another machine | `http://<that-machine-address>:9696` |

4. Select <Ui k="panel.sources.importDialog.submit" />. Torsher adds every indexer of the manager.

Torsher doesn't watch the manager by itself. When you add or remove indexers there, open <Ui k="panel.nav.sources" /> and use the sync button on the manager's card: new indexers are added, and ones gone from the manager are marked rather than deleted.

## Option C: one Torznab indexer

For an indexer that isn't in a manager, open <Ui k="panel.nav.sources" />, select <Ui k="panel.sources.add" /> and enter its <Ui k="panel.sources.addDialog.url" /> and <Ui k="panel.sources.addDialog.apiKey" />. The server checks the indexer before saving it.

## Releases in other languages

Torsher reads release titles in English and Russian, including season and episode ranges, quality, and voice-over studios and markers. Indexers with Russian-language releases work as well as English ones: the showcase shows the voice-over of each release and filters by it.

## Check

Open any title on the TV and select <Ui k="title.watch" />. The <Ui k="sources.title" /> screen lists releases from your indexers. <Ui k="panel.nav.sources" /> in the panel shows each indexer with its status.

## If something went wrong

- **<Ui k="panel.wizard.sources.notFound" />.** The manager runs at another address or port: connect it by address as in Option B.
- **The import fails.** Check the address from the Torsher server's point of view and the API key. A `localhost` address points at the Torsher container itself, not at your machine.
- **Some indexers are not responding.** The <Ui k="sources.title" /> screen says how many didn't answer. Check them in the manager. If the server can't reach a site directly, add a route through your proxy in [Network](/docs/setup/network).

## Next

[TMDB key](/docs/setup/tmdb), if the catalog is empty, or [Connect a device](/docs/tv/connect).
