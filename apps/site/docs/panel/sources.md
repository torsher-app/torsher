---
title: Sources
description: "The indexers Torsher searches: managers imported from Prowlarr or Jackett and their sync, indexers added by hand, statuses and checks, editing, disabling and deleting."
---

# Sources

<Ui k="panel.nav.sources" /> lists the Torznab indexers the server searches for releases: any Torznab indexer works, for example Prowlarr or Jackett. Here you check that they answer, sync a manager, and turn indexers on and off. Torsher ships with no sources: you decide which ones to connect.

::: tip What you'll learn
How to read the list of indexers and their statuses, how to keep a manager in sync, and what to do when an indexer stops answering.
:::

## Before you start

- To connect your first indexers, follow [Indexers](/docs/setup/indexers). This page describes the section once they are there.

## Connect a source

Two buttons in the top bar:

- **<Ui k="panel.sources.importShort" />** opens <Ui k="panel.sources.import" />. Choose the manager, enter its address and API key, and select <Ui k="panel.sources.importDialog.submit" />. Torsher adds all its indexers and checks them. The address is how the Torsher server reaches the manager, for example `http://prowlarr:9696` in the same `docker-compose.yml`, not `localhost`.
- **<Ui k="panel.sources.add" />** adds one Torznab indexer: a <Ui k="panel.sources.addDialog.name" />, its <Ui k="panel.sources.addDialog.url" /> and <Ui k="panel.sources.addDialog.apiKey" />. Leave the key empty if the indexer needs none. <Ui k="panel.sources.addDialog.submit" /> checks the indexer before saving it.

## The list

Indexers are grouped:

- **<Ui k="panel.sources.groups.attention" />.** Indexers that don't answer, reject the key or are gone from their manager.
- **One group per manager,** Prowlarr or Jackett, with its address and when it was last synced.
- **<Ui k="panel.sources.groups.manual" />.**

Above the list are the filters <Ui k="panel.sources.filters.all" />, <Ui k="panel.sources.filters.attention" /> and <Ui k="panel.sources.filters.disabled" />, a search by name, and <Ui k="panel.sources.checkAll.action" />. A check runs in the background: you can switch to another section meanwhile.

## Statuses

| Status | What it means |
| --- | --- |
| <Ui k="panel.sources.status.ok" /> | The last check passed. |
| <Ui k="panel.sources.status.pending" /> | Not checked yet. |
| <Ui k="panel.sources.status.disabled" /> | Search is off for it. |
| <Ui k="panel.sources.status.auth" /> | The indexer rejected the API key. |
| <Ui k="panel.sources.status.timeout" /> | It didn't respond in time. Search goes on through the others. |
| <Ui k="panel.sources.status.unreachable" /> | The server can't reach the address. |
| <Ui k="panel.sources.status.bad_response" /> | The address answered, but not with Torznab. |
| <Ui k="panel.sources.status.remote" /> | The indexer answered with an error. |
| Gone from the manager | It was removed in Prowlarr or Jackett, and Torsher doesn't search it. Add it back in the manager and sync, or delete it. |

Searches skip an indexer that keeps failing: for a minute after the first error, then longer after each one, up to a day. This covers both the <Ui k="sources.title" /> screen on the TV, where a skipped indexer counts as one that didn't answer, and background searches by Following. When every indexer is paused, the TV asks them all anyway.

## Keep a manager in sync

Torsher doesn't watch the manager by itself. After you add, remove or change indexers in Prowlarr or Jackett, select the sync button next to the manager's name. New indexers are added, changed ones are updated, and ones gone from the manager are marked rather than deleted. A toast says how many were added, updated and gone.

The menu next to it opens the manager's own interface, takes a new API key with <Ui k="panel.sources.managers.changeKey" /> after you change it in the manager, or disconnects it. When you disconnect a manager, choose what happens to its indexers:

- <Ui k="panel.sources.managers.deleteIndexers" />: only the indexers added by hand remain.
- Keep them: they become manual indexers and search keeps working.

## An indexer's card

Click an indexer to open its card:

- **<Ui k="panel.sources.card.search" />.** The switch that turns search on or off for this indexer.
- **<Ui k="panel.sources.feed.label" />.** When Following last read the indexer's new releases feed, and a switch to turn it off. See [Following](/docs/panel/follow#settings).
- **<Ui k="panel.sources.card.status" />.** The last check and its result.
- **<Ui k="panel.sources.card.url" />,** **<Ui k="panel.sources.card.source" />** (the manager or <Ui k="panel.sources.indexers.manual" />), **<Ui k="panel.sources.card.modes.label" />** and **<Ui k="panel.sources.card.categories" />.**

Buttons at the bottom: <Ui k="panel.sources.indexers.test" />, <Ui k="panel.sources.indexers.edit" /> for an indexer added by hand (its name and a new API key; leave the key empty to keep the current one) or a link to the manager for an imported one, and <Ui k="panel.common.delete" />.

The menu at the end of each row has the same actions, plus <Ui k="panel.sources.indexers.disable" /> or <Ui k="panel.sources.indexers.enableSearch" /> and <Ui k="panel.sources.indexers.copyUrl" />.

## Disable or delete an indexer

- **Disable** keeps the indexer in the list but leaves it out of every search.
- **Delete** removes it. An indexer imported from a manager comes back with the next sync. To keep it out of search, disable it here or delete it in the manager: the delete dialog offers <Ui k="panel.sources.indexers.disableInstead" /> for that.

## If something went wrong

- **An indexer doesn't respond or rejects the key.** For an imported one, update the key in the manager and sync. For one added by hand, enter the new key with <Ui k="panel.sources.indexers.edit" />. See [An indexer doesn't respond](/docs/troubleshooting#indexer-error).
- **The import or sync fails.** Check the address from the Torsher server's point of view and the API key. See [Prowlarr or Jackett not found](/docs/troubleshooting#manager-not-found).
- **The site is unreachable from your network.** Add a route through your proxy, see [Network](/docs/setup/network).
- **Search on the TV finds nothing.** See [Search finds nothing](/docs/troubleshooting#nothing-found).

## Next

- [Library](/docs/panel/library).
- [Following](/docs/panel/follow): how the automation uses your indexers.
