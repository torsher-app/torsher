---
title: TMDB key
description: "The Torsher catalog comes from TMDB. When the server needs your own TMDB key, how to get one for free and where to enter it."
---

# TMDB key

Titles, posters, descriptions and cast in the showcase come from [TMDB](https://www.themoviedb.org/), a community-built movie and TV database. The server needs a TMDB key to use it. A build may come with an app key; your own key works regardless and keeps working if TMDB revokes the app key.

::: tip What you'll get
<Ui k="panel.settings.metadata.check.ok" /> in the panel and a full catalog on the TV.
:::

## Do you need your own key

Open <Ui k="panel.nav.settings panel.settings.nav.metadata" /> in the panel, or look at the <Ui k="panel.wizard.steps.network.title" /> step of the setup wizard:

- <Ui k="panel.wizard.network.key.ok" />: nothing to do.
- <Ui k="panel.wizard.network.key.missing" /> or <Ui k="panel.wizard.network.key.rejected" />: get your own key below.
- <Ui k="panel.wizard.network.key.unavailable" />: the server doesn't reach TMDB at all. Fix the network first, see [Network](/docs/setup/network).

## 1. Get a key

1. Sign up at [themoviedb.org](https://www.themoviedb.org/signup) and confirm your email.
2. Open your account settings, section [API](https://www.themoviedb.org/settings/api), and request an API key for personal use.
3. Copy the **API Read Access Token** (a long string) or the **API Key** (32 characters). Either works.

## 2. Enter it

In <Ui k="panel.nav.settings panel.settings.nav.metadata" />, under <Ui k="panel.settings.metadata.tmdbTitle" />, choose <Ui k="panel.settings.metadata.custom" />, paste the key and save. In the wizard, the same card is below the network checks.

The catalog uses the key from the next request. Select <Ui k="panel.settings.metadata.check.action" /> to test it.

You can also set the token in `docker-compose.yml` as `TMDB_ACCESS_TOKEN`. A key saved in the panel takes precedence.

## If something went wrong

- **<Ui k="panel.settings.metadata.check.rejected" />.** Copy the key again without spaces, or try the other of the two values from the TMDB API page.
- **<Ui k="panel.settings.metadata.check.unavailable" />.** Your network can't reach TMDB: often the DNS of the provider returns a wrong address. See [Network](/docs/setup/network).

## About TMDB data

Torsher keeps TMDB data and images for no longer than TMDB's terms allow and shows TMDB attribution on the <Ui k="common.about" /> screen. This product uses the TMDB API but is not endorsed or certified by TMDB.
