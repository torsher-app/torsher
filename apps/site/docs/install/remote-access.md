---
title: Remote access
description: "Reach Torsher from outside your home: which ports to expose, a reverse proxy with HTTPS (Caddy, Traefik, Nginx Proxy Manager), TRUST_PROXY and secure cookies, or a VPN such as Tailscale."
---

# Remote access

Torsher serves plain HTTP for your home network and has no built-in HTTPS. To reach it from outside, put a reverse proxy with HTTPS in front of it, or connect over a VPN such as Tailscale. This page covers what Torsher needs in both cases.

::: tip What you'll get
The panel and the showcase at an HTTPS address or over your VPN, with sign-in limits and the log seeing the real address of each client.
:::

## Before you start

- Torsher works in your home network: `http://<server-address>:8080/panel/` opens. See [Docker Compose](/docs/install/docker-compose).
- For a reverse proxy: a domain name that points to your public IP address, and ports 80 and 443 forwarded on your router to the machine running the proxy.
- For a VPN: an account with the VPN service and its app on the server and on the devices you connect from.

::: warning Don't forward port 8080 to the internet
Over plain HTTP your password and sign-in cookies travel unencrypted. Reach Torsher from outside only through a reverse proxy with HTTPS or a VPN.
:::

## What to expose

| Port | What for | From outside |
| --- | --- | --- |
| `8080` | Everything: the showcase at `/`, the control panel at `/panel/` and the API at `/api` | Only through a reverse proxy or a VPN |
| `ENGINE_PEER_PORT` | Incoming connections from torrent peers, TCP and UDP | Optional. Not needed for remote access; forwarding it on the router only brings more peers |

Nothing else needs publishing: the torrent engine's own API listens inside the container only. The peer port is set in <Ui k="panel.nav.settings panel.settings.nav.torrent" />, card <Ui k="panel.settings.torrent.port.title" />; see [Configuration](/docs/install/configuration#environment-variables).

## Option A: a reverse proxy with HTTPS

A reverse proxy takes HTTPS requests for your domain and passes them to Torsher on port 8080. Whatever proxy you use, Torsher needs four things:

1. **Its own host name.** Serve Torsher at the root of a domain or subdomain, such as `torsher.example.com`. A path like `example.com/torsher/` doesn't work: the panel and the API expect `/panel/` and `/api` at the root.
2. **The original host and client headers.** The proxy passes `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. Caddy and Traefik do this by default.
3. **`TRUST_PROXY`** set to the proxy's address as Torsher sees it. See [Set TRUST_PROXY](#set-trust-proxy).
4. **Large uploads allowed.** Restoring a backup uploads a file of up to 2 GB through the proxy. Nginx, and proxies built on it, limit request bodies to 1 MB by default.

The examples below put the proxy into the same `docker-compose.yml` as Torsher, so it reaches Torsher as `torsher:8080`. Replace `torsher.example.com` with your domain. None of these setups is tested by the project yet (not verified); follow the proxy's own documentation where it differs.

### Caddy

[Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy) gets and renews an HTTPS certificate on its own. Add a service under `services:` in `docker-compose.yml`:

```yaml
caddy:
  image: caddy:2
  container_name: caddy
  restart: unless-stopped
  ports:
    - '80:80'
    - '443:443'
  volumes:
    - ./Caddyfile:/etc/caddy/Caddyfile
    - ./caddy:/data
```

Create `Caddyfile` next to `docker-compose.yml`:

```text
torsher.example.com {
	reverse_proxy torsher:8080
}
```

### Traefik

If you already run [Traefik](https://doc.traefik.io/traefik/providers/docker/) with the Docker provider, add labels to the `torsher` service. The entry point and certificate resolver names must match your Traefik configuration, and Traefik must share a Docker network with Torsher.

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.torsher.rule=Host(`torsher.example.com`)
  - traefik.http.routers.torsher.entrypoints=websecure
  - traefik.http.routers.torsher.tls.certresolver=<resolver>
  - traefik.http.services.torsher.loadbalancer.server.port=8080
```

### Nginx Proxy Manager

In [Nginx Proxy Manager](https://nginxproxymanager.com/guide/), add a proxy host for `torsher.example.com` that forwards to `http`, host `torsher` (or the server's address if it runs elsewhere), port `8080`, and request a certificate for it. If restoring a backup through the proxy fails, raise the body limit in the proxy host's advanced settings:

```nginx
client_max_body_size 2g;
```

### Set TRUST_PROXY {#set-trust-proxy}

Behind a proxy, every request reaches Torsher from the proxy's address. `TRUST_PROXY` tells Torsher which address that is, so it takes the client's real address from `X-Forwarded-For` and the scheme from `X-Forwarded-Proto`. Without it:

- sign-in attempt limits count every client as one address, so failed attempts from anyone can lock you out for a while;
- the log shows the proxy's address instead of the client's;
- sign-in cookies are not marked secure, because Torsher sees plain HTTP from the proxy.

With the proxy in the same Compose file, use the subnet of their network. Find it:

```bash
docker network inspect torsher_default --format '{{range .IPAM.Config}}{{.Subnet}}{{end}}'
```

`torsher_default` is the network Compose creates for a project in a folder named `torsher`. List the networks with `docker network ls` if yours is named differently.

Set the result in the `environment:` of the `torsher` service:

```yaml
TRUST_PROXY: 172.18.0.0/16
```

Other accepted values: one address, several addresses or subnets separated by commas, `loopback`, `uniquelocal` (all private ranges), or `true` to trust any. A wrong value stops the server at start with a message about `TRUST_PROXY`.

::: warning Trust only the proxy
Don't set `TRUST_PROXY` without a proxy, and avoid `true` and `uniquelocal` when other devices can reach port 8080 directly: any of them could then claim any address and get around the sign-in limit.
:::

Apply the changes:

```bash
docker compose up -d
```

### Secure cookies

Torsher marks its sign-in cookies `Secure` when it sees the request as HTTPS. Behind a proxy that means `TRUST_PROXY` is set and the proxy sends `X-Forwarded-Proto: https`. In your home network over `http://`, cookies stay without `Secure`, otherwise the browser wouldn't keep them. You don't need to set anything else.

## Option B: Tailscale or another VPN

A VPN connects your devices into one private network. Nothing is forwarded on the router, and Torsher stays as it is: no proxy and no `TRUST_PROXY`.

1. Install [Tailscale](https://tailscale.com/kb/1017/install) on the server and on the phone or laptop you connect from, and sign in to the same account on both.
2. Find the server's Tailscale address or name in the Tailscale app or admin console.
3. Open `http://<tailscale-address>:8080/panel/` on your device.

Traffic between your devices is encrypted by the VPN, so plain HTTP inside it is fine. Devices at home keep using the local address.

Tailscale can also serve Torsher over HTTPS with `tailscale serve` (not verified). That makes Tailscale a reverse proxy in front of Torsher: [set TRUST_PROXY](#set-trust-proxy) for it.

## Check

- `https://torsher.example.com/api/health` (or the VPN address) answers from a device outside your home network, for example a phone on mobile data.
- The panel opens and you can sign in.
- With a reverse proxy: sign in once with a wrong password, then open the <Ui k="panel.logs.sources.auth" /> entry in <Ui k="panel.nav.logs" />. Its <Ui k="panel.logs.card.context" /> shows your device's public address, not the proxy's.

## If something went wrong

- **The domain doesn't open.** Check that the domain points to your public IP address and that ports 80 and 443 are forwarded to the proxy. If your provider gives you no public IP address, use a VPN instead.
- **The proxy shows a 502 error.** The proxy doesn't reach Torsher. With the proxy in the same Compose file, the address is `torsher:8080`; otherwise use the server's address and check that port 8080 is published.
- **Torsher doesn't start after setting `TRUST_PROXY`.** The value isn't a valid address or subnet. Read the reason with `docker compose logs torsher`.
- **The log still shows the proxy's address.** `TRUST_PROXY` doesn't match the address the proxy connects from. Use the network subnet as above.
- **Restoring a backup fails through the proxy.** Raise the proxy's request body limit, or restore from the home network.

More in [Troubleshooting](/docs/troubleshooting#panel-unreachable).

## Next

- [Configuration](/docs/install/configuration).
- [Connect a device](/docs/tv/connect).
