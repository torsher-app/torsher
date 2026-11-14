---
title: Network
description: "How the server reaches TMDB, indexers and other services: host checks, spoofed DNS and DNS over HTTPS, per-host routes through your own SOCKS5 or HTTP proxy, and the proxy from the environment."
---

# Network

Every request the server makes goes through one network layer that you control in <Ui k="panel.nav.settings panel.settings.nav.network" />. This page explains how to see which hosts the server reaches, fix spoofed DNS with DNS over HTTPS, and send chosen hosts through your own proxy.

::: tip What you'll get
TMDB, your indexers and notification channels reachable from the server, with DNS over HTTPS or your own proxy only where your network needs it.
:::

## Before you start

- Torsher is running and you can open the control panel. See [Docker Compose](/docs/install/docker-compose).
- For a proxy route: a SOCKS5 or HTTP proxy of your own that the server can reach. Torsher doesn't provide one.

## What these settings cover

Routes and DNS settings apply to every outgoing request of the server:

- the TMDB catalog and images;
- Prowlarr, Jackett and Torznab indexers you connected, including `.torrent` files they link to;
- notification channels, email included;
- the IMDb ratings download and the update check, if they are on.

They don't apply to:

- **Torrent peers.** The torrent engine connects to peers directly.
- **Indexers inside Prowlarr or Jackett.** Torsher talks to the manager, and the manager reaches its indexers itself. If an indexer site is unreachable from your network, set up a proxy in the manager's own settings.
- **Your browser and TV.** They connect to the Torsher server, not through it.

## Check which hosts respond

The <Ui k="panel.settings.network.hosts.title" /> card at the top of the page lists the hosts the server talks to: the <Ui k="panel.wizard.network.hosts.tmdb" />, <Ui k="panel.wizard.network.hosts.tmdb_images" />, every connected Prowlarr or Jackett and every indexer you added by hand. Indexers imported from a manager share its line: the server reaches them through the manager's address.

Select <Ui k="panel.settings.network.hosts.checkAll" />. The check runs on the server, not in your browser, and keeps going if you leave the page. To check one host, open the menu at the end of its line and select <Ui k="panel.settings.network.hosts.check" />.

The server also checks all hosts on start and every 30 minutes. A host that stops responding shows up in <Ui k="panel.overview.attention.title" /> on <Ui k="panel.nav.overview" />, and the change is written to the log under <Ui k="panel.logs.sources.network" />.

| Status | What it means | What to do |
| --- | --- | --- |
| <Ui k="panel.settings.network.status.ok" /> | The host answered. A refusal without a key or a redirect counts too | Nothing |
| <Ui k="panel.settings.network.status.spoofedRouted" /> | The system DNS returns a wrong address, and the host works only thanks to its route | Keep the route |
| <Ui k="panel.settings.network.status.dns" /> | The host name doesn't resolve | Turn on [DNS over HTTPS](#spoofed-dns-and-dns-over-https) |
| <Ui k="panel.settings.network.status.doh" /> | The DNS over HTTPS provider of the route doesn't answer | Choose another provider |
| <Ui k="panel.settings.network.status.timeout" /> | No answer in 8 seconds | Check the server's connection, or the proxy of the route |
| <Ui k="panel.settings.network.status.refused" /> | The connection failed | Check the address of the host, or the proxy of the route |
| <Ui k="panel.settings.network.status.tls" /> | The certificate doesn't match the host. The address may be spoofed | Turn on DNS over HTTPS |
| <Ui k="panel.settings.network.status.http" /> | The host answered with a 5xx error | The problem is on the host's side; try later |

If a host has a problem and DNS over HTTPS doesn't help, give it a [route through your proxy](#add-a-route): in the menu of its line, select <Ui k="panel.settings.network.hosts.createRoute" />. The host is already filled in.

## Measure connection speed {#speed-check}

Open <Ui k="panel.nav.settings panel.settings.nav.network" /> and find <Ui k="speedtest.title" />. Nothing runs until you select <Ui k="speedtest.start" />.

1. Use <Ui k="speedtest.localTitle" /> to measure **server → this browser** through the address you opened, including its reverse proxy, VPN or remote connection. To measure a television, start the check in [showcase settings](/docs/watch/showcase#connection-check) on that TV.
2. Use <Ui k="speedtest.internetTitle" /> to measure **server ↔ Cloudflare**. The server downloads and uploads the test data; the browser only reads progress. The card shows the route and DNS used for `speed.cloudflare.com`, including your environment proxy and `NO_PROXY` exceptions.
3. Read the speed result and graph in <Ui k="speedtest.mbps" />, the <Ui k="speedtest.latency" />, measured duration, start time and test data transferred. This latency is a median HTTP round trip, not ICMP ping. The showcase offers the same server internet check in <Ui k="nav.settings speedtest.title speedtest.internetTitle" /> without a graph; it still measures the server, not the TV's own internet connection. A dash means no numerical result, not zero speed.
4. Select <Ui k="speedtest.stop" /> to stop. The last shown speed, latency, duration, traffic and graph stay visible with a stopped status; these are partial measurements. Only the next <Ui k="speedtest.start" /> for that test clears them. Leaving or hiding the page, signing out or closing the showcase panel also stops the check. A lost internet-check page expires on the server after five seconds without a heartbeat. Reopening never restarts a check automatically.

Both checks use sequential finite HTTP requests with an adaptive payload size, starting at 16 KiB after a separate 16 KiB warmup. Sizes grow toward roughly 400 ms of payload transfer. **Measurement runs for ten seconds after warmup**, even when early responses are stable. A useful statistical sample is a fully completed positive transfer lasting at least 10 ms; at least three samples are required. The number is their linearly interpolated **90th percentile**, not the average or maximum. HTTP timing includes latency and response startup; neither is subtracted from a speed result.

The graph shows the same current speed estimate as the main number, refreshed every 200 ms from completed HTTP measurements. Before enough valid measurements are available, the grid waits without inventing zero-speed points. Waiting for the final request or upload acknowledgement does not by itself lower the estimate to zero; a later completed request can update it. The final point at ten seconds equals the final confirmed estimate. The graph points are periodic views of that estimate, not additional independent HTTP samples.

The local check has a **64 GiB safety ceiling** and **64 MiB per request**. The server internet check has **64 GiB per direction**, **250 MB per download request**, **50 MB per upload request**, and **128 GiB total**. Its payload planner targets roughly one second, using the request size limits from the Cloudflare reference configuration; the local planner remains at roughly 400 ms. Each direction permits at most 4096 requests including warmup. These are emergency ceilings, not normal completion conditions. Reaching one before ten seconds makes that phase incomplete, with no successful numerical result. Warmup and aborted requests count toward the budget; headers and TLS add network traffic. The final in-flight HTTP request is aborted at ten seconds: its payload appears in the traffic total, but not in the speed estimate. Global preparation/measurement deadlines remain 15 seconds for local and 30 seconds for the two server internet directions.

If the server internet check fails, open <Ui k="panel.nav.logs" />, filter by <Ui k="panel.logs.sources.network" /> and search for `speedtest.failed`. Open the warning to see the test ID, failed phase, route, HTTP status and available provider diagnostics: Cloudflare Ray ID, challenge marker, error code and retry time. Response server and content type are normalized; proxy addresses, cookies and response bodies are excluded. These clues can narrow down a 403 or 429, but may not identify the exact blocking rule. Successful checks and manual stops do not create this warning. The same fields are included in the downloaded problem report.

The server internet chart overlays download and upload on the same axes. Transfers run sequentially; each direction has its own measured timeline from zero to ten seconds after warmup. No partial request becomes a statistical sample. While another request is pending, the chart shows the current confirmed estimate rather than inventing zero-throughput measurements.

Only one check runs on a server at a time, with no frequency limit for the owner. Connected viewer devices share three successful starts per minute across local and server internet checks; a busy server or invalid request does not use that allowance. Ongoing viewing and downloads keep running and share the connection. The result is measured end-to-end transfer speed under that load; it does not promise a torrent's speed, a maximum internet tariff speed or successful playback of a particular video.

Cloudflare and any configured proxy see the server's connection. Torsher sends no cookies, tokens, device identifiers or media information to Cloudflare, and does not submit a separate results report. The provider can refuse requests or change its protocol; there is no automatic fallback. The local check works independently. The external request-size cap and HTTP latency can reduce the measured end-to-end speed to Cloudflare, especially on fast, distant routes. Results are temporary, with no saved history or scheduled checks. Demo results are fictional and generate no real test traffic.

Physical TV throughput and your reverse proxy's buffering need checking on that device and route. A desktop result does not verify them. See [speed-check problems](/docs/troubleshooting#speed-check).

## Spoofed DNS and DNS over HTTPS

Some networks answer DNS requests for some sites with a wrong address. The server then can't reach the site, or reaches a different server with the wrong certificate.

For hosts reached directly, Torsher detects this on every check. It asks the system DNS and a DNS over HTTPS (DoH) provider for the same name. If the two answers have no address in common and the request through the system DNS fails, the line says the DNS is spoofed. Different addresses alone are not a problem: large sites legitimately return different addresses to different resolvers.

To fix it for all hosts:

1. In the <Ui k="panel.settings.network.dnsCard.title" /> card, choose <Ui k="panel.settings.network.dns.quad9" />, <Ui k="panel.settings.network.dns.google" /> or <Ui k="panel.settings.network.dns.cloudflare" />.
2. Select <Ui k="panel.common.save" />. New requests use it right away.
3. Select <Ui k="panel.settings.network.hosts.checkAll" />.

The built-in providers are contacted by IP address, so they work even when the system DNS is spoofed. Which one works depends on your network: if the check says <Ui k="panel.settings.network.status.doh" />, try another one.

<Ui k="panel.settings.network.dns.custom" /> takes the address of any DNS over HTTPS server (RFC 8484), for example `https://doh.example/dns-query`. It must start with `https://`.

To use DoH for only some hosts, leave the default DNS as it is and [add a route](#add-a-route) for those hosts with <Ui k="panel.settings.network.via.direct" /> and a DoH provider.

## Routes

A route tells the server how to reach a host: directly, through a SOCKS5 proxy or through an HTTP proxy, and which DNS to use. The <Ui k="panel.settings.network.routes.title" /> card lists them. The last one, <Ui k="panel.settings.network.routes.default" />, applies to every host without its own route. You can edit it, but not delete it.

### Add a route

1. In the <Ui k="panel.settings.network.routes.title" /> card, select <Ui k="panel.settings.network.routes.add" />.
2. In <Ui k="panel.settings.network.routeDialog.match" />, enter the host:
   - `indexer.example`: this host only;
   - `*.indexer.example`: all its subdomains, such as `api.indexer.example`, but not `indexer.example` itself. Add a second route for it if you need both.

   No scheme, port or path. An IP address works as an exact host.
3. Under <Ui k="panel.settings.network.routeDialog.via" />, choose <Ui k="panel.settings.network.via.direct" />, <Ui k="panel.settings.network.via.socks5h" /> or <Ui k="panel.settings.network.via.http" />.
4. For a proxy, enter the <Ui k="panel.settings.network.routeDialog.proxy" /> as `host:port`, for example `192.168.1.10:1080`. The port is required. A scheme is optional: `socks5://` for SOCKS5, `http://` for an HTTP proxy. If the proxy asks for sign-in, fill in <Ui k="panel.settings.network.routeDialog.username" /> and <Ui k="panel.settings.network.routeDialog.password" />.
5. For <Ui k="panel.settings.network.via.direct" />, choose the <Ui k="panel.settings.network.routeDialog.dns" />: the system DNS or a DoH provider. A proxy route has no DNS setting: the proxy resolves host names itself, so spoofed DNS in your network doesn't affect it.
6. Select <Ui k="panel.settings.network.routeDialog.submit" />.

The route works for new requests right away. Select <Ui k="panel.settings.network.hosts.checkAll" /> to see the result.

Proxy usernames and passwords are stored encrypted, like indexer API keys. When you edit a route, leave them empty to keep the saved ones, or select <Ui k="panel.settings.network.routeDialog.forgetCredentials" /> to delete them.

### Which route wins

- A route for the exact host beats any mask.
- Among masks, the first matching one from the top wins. Reorder them with the arrows next to each route.
- <Ui k="panel.settings.network.routes.default" /> comes last.

When a host redirects to another host, the route is chosen again for the new host. Sign-in and API key headers are not sent along to a different host, and a redirect from `https` to `http` is refused.

### Send everything through a proxy

Edit <Ui k="panel.settings.network.routes.default" /> and choose <Ui k="panel.settings.network.via.socks5h" /> or <Ui k="panel.settings.network.via.http" />.

That route covers every host, including services in your own network: Prowlarr, Jackett, a notification server. If the proxy can't reach them, add a <Ui k="panel.settings.network.via.direct" /> route for each, for example `prowlarr` or `192.168.1.20`.

## Proxy from the environment

If the container has `HTTPS_PROXY` or `HTTP_PROXY` set, the server uses that proxy for hosts without their own route, and `NO_PROXY` lists the exceptions. The routes list then shows <Ui k="panel.settings.network.via.env" /> for <Ui k="panel.settings.network.routes.default" />.

```yaml
environment:
  HTTPS_PROXY: http://192.168.1.10:3128
  NO_PROXY: prowlarr,localhost
```

::: info The environment proxy is a starting point
It applies only while <Ui k="panel.settings.network.routes.default" /> is left as it was installed: direct, with the system DNS. Choosing DoH or a proxy for that route turns the environment proxy off. Routes for individual hosts never use it.
:::

## Run your own proxy next to Torsher

Torsher works with any SOCKS5 or HTTP proxy. Which proxy you run and how you configure it is up to you. Two common setups:

### A proxy service in the same Compose file

Add the proxy as another service under `services:` in `docker-compose.yml`, next to `torsher`. Services in one file share a network, so Torsher reaches the proxy by its service name. Don't publish the proxy's port: only containers in this file need it.

```yaml
proxy:
  image: <proxy-image>
  container_name: proxy
  restart: unless-stopped
  # No ports: section. Only containers in this file reach the proxy
```

Replace `<proxy-image>` with the image of your proxy and configure it as its documentation says. Then create a route with <Ui k="panel.settings.network.via.socks5h" /> and the address `proxy:1080`, or with <Ui k="panel.settings.network.via.http" /> and the port your proxy listens on.

### A proxy on the host or another device

A proxy on your router, another server or the Docker host itself is reached by its address in your network, for example `192.168.1.10:1080`. It must accept connections from that network, not only from `127.0.0.1`.

Inside the container, `localhost` is the container itself, not the host. To reach a proxy on the Docker host by name, add this to the `torsher` service and use `host.docker.internal:1080` as the proxy address (not verified):

```yaml
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Apply changes to `docker-compose.yml`:

```bash
docker compose up -d
```

## Check

- In <Ui k="panel.settings.network.hosts.title" />, every host says <Ui k="panel.settings.network.status.ok" /> or <Ui k="panel.settings.network.status.spoofedRouted" />.
- The showcase shows the catalog with posters.
- <Ui k="panel.overview.attention.title" /> on <Ui k="panel.nav.overview" /> has no network items.

## If something went wrong

- **DNS returns a wrong address.** See [Troubleshooting](/docs/troubleshooting#dns-spoofing).
- **A host is unreachable.** See [Troubleshooting](/docs/troubleshooting#host-unreachable).
- **Every DoH provider says it doesn't respond.** The server doesn't reach them either. Add a route through your proxy for the hosts you need.
- **A proxy route says <Ui k="panel.settings.network.status.refused" /> or <Ui k="panel.settings.network.status.timeout" />.** The proxy is down or the server doesn't reach it. A proxy container must be in the same Compose file as Torsher or on a network the container reaches; a proxy on another machine must accept connections from the server.
- **<Ui k="panel.settings.network.serverErrors.duplicate.match" />.** Each host or mask has one route. Find it in the list and edit it.
- **An indexer from Prowlarr or Jackett doesn't respond, but the manager's line is fine.** The manager can't reach that indexer. Set up its proxy in the manager.

More in [Troubleshooting](/docs/troubleshooting#network-and-tmdb) and [Logs and diagnostics](/docs/maintain/logs).

## Next

- [Storage](/docs/setup/storage).
- [Indexers](/docs/setup/indexers).
- [Remote access](/docs/install/remote-access).
