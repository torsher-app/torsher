---
title: VPN with Gluetun
description: Run Torsher through a WireGuard VPN with Gluetun, keep the showcase available on your local network, and connect Prowlarr.
---

# VPN with Gluetun

This setup runs Torsher in Gluetun's network namespace. Gluetun routes the torrent engine and the rest of Torsher through your VPN, and its firewall blocks Internet access if the tunnel drops. The panel and showcase stay reachable from your local network while both containers are running.

## Before you start

- Use a Linux host with [Docker Compose](/docs/install/docker-compose) and `/dev/net/tun`.
- Get a WireGuard client configuration from your VPN provider or your own VPN server. Use a numeric IP for the WireGuard endpoint in `wg0.conf`. This example assumes the tunnel carries Internet traffic.
- Find the host's LAN address and subnet. Use the actual subnet, for example `192.168.1.0/24`. It must not overlap the VPN tunnel's address range.
- Keep `wg0.conf` private. It contains your WireGuard private key.

If you already run Torsher, stop its container before switching networks. Keep the same Compose project and Torsher data mounts so the container starts with the existing database and library.

## 1. Start Gluetun and Torsher

Put `wg0.conf` next to `docker-compose.yml`. In the example below, replace `192.168.1.10` with the Docker host's LAN address and `192.168.1.0/24` with your own LAN subnet. Keep your existing `/data` and library mounts if you're switching an existing install.

```yaml
services:
  gluetun:
    image: qmcgaw/gluetun:v3.41.3
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    environment:
      VPN_SERVICE_PROVIDER: custom
      VPN_TYPE: wireguard
      FIREWALL_OUTBOUND_SUBNETS: 192.168.1.0/24
    volumes:
      - ./wg0.conf:/gluetun/wireguard/wg0.conf:ro
    ports:
      - '192.168.1.10:8080:8080'
    networks:
      - media

  torsher:
    image: ghcr.io/torsher-app/torsher:latest
    network_mode: service:gluetun
    depends_on:
      gluetun:
        condition: service_healthy
    environment:
      PUID: 1000
      PGID: 1000
      TZ: Etc/UTC
    volumes:
      - ./data:/data

  prowlarr:
    image: lscr.io/linuxserver/prowlarr:latest
    profiles: [prowlarr]
    environment:
      PUID: 1000
      PGID: 1000
      TZ: Etc/UTC
    volumes:
      - ./prowlarr:/config
    networks:
      - media

networks:
  media:
```

Run `docker compose up -d`, or `docker compose --profile prowlarr up -d` if you want the optional Prowlarr service. Compose waits for Gluetun's health check before starting Torsher. Run `docker compose ps`, then open `http://192.168.1.10:8080/panel/` from your LAN. The same host and port serve the showcase.

`FIREWALL_OUTBOUND_SUBNETS` gives both Gluetun and Torsher direct access to the listed LAN destinations. Keep the list narrow. Keep Gluetun's firewall enabled.

::: warning Start this stack through Compose
After a host or Docker restart, run the same Compose command again, including `--profile prowlarr` if you use that service. This example leaves Docker restart policies off so Compose can check Gluetun's health on each cold start. Docker's automatic container restarts do not wait on Compose's `service_healthy` condition. If a database restore stops Torsher, start it through Compose again.
:::

## 2. Connect Prowlarr

Prowlarr runs on the same Docker network as Gluetun in its own network namespace. In Torsher, register it at `http://prowlarr:9696` with your Prowlarr API key. See [Indexers](/docs/setup/indexers). To configure its web interface, you can add a temporary port mapping of `127.0.0.1:9696:9696` under `prowlarr` and open it from the Docker host.

Give Prowlarr its own network namespace so it cannot reach the engine's internal loopback API. If the name does not resolve, check that Gluetun's DNS is running and its upstream resolver is reachable through the tunnel. If you already run Prowlarr elsewhere, use its reachable address and allow only the local network it needs.

## 3. Allow incoming peers if your VPN supports it

Outgoing peer connections work without port forwarding. If your provider has assigned a fixed VPN port, set the same number in Gluetun and Torsher. Here is how to use an assigned port of `51413`.

- Add `FIREWALL_VPN_INPUT_PORTS: '51413'` under Gluetun's `environment`.
- Add `ENGINE_PEER_PORT: '51413'` under Torsher's `environment`.
- [Recreate Gluetun and Torsher](#update-or-replace-gluetun) to apply the environment changes.
- In <Ui k="panel.nav.settings panel.settings.nav.torrent" />, check the saved peer port and turn off UPnP for this setup. The saved peer port takes precedence over `ENGINE_PEER_PORT`. Save any changes and select <Ui k="panel.settings.torrent.restart.button" /> to apply them.

Check the running port in the engine's `engine network configured` log entry, then test an incoming connection from outside your LAN via the VPN address. Keep the peer port out of Docker's `ports:` list. The VPN provider forwards it through the tunnel. Docker publishes the panel and showcase on the host. If your provider rotates the port, repeat these steps with the new value. See [Gluetun's port forwarding guide](https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/vpn-port-forwarding.md).

## Update or replace Gluetun

Torsher joins the network namespace of the specific Gluetun container. When replacing that container, recreate Torsher as well, preserving its data mounts.

```bash
docker compose stop torsher
docker compose up -d --force-recreate --wait gluetun
docker compose up -d --force-recreate --wait torsher
```

Use `docker compose ps` to confirm both services are running, then open the showcase again from your LAN.
