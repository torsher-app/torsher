# Torsher

Self-hosted media center in a single Docker container: browse a catalog, start watching a torrent right away, keep what you watched in your own library, and let new episodes arrive on their own.

Torsher combines a BitTorrent client, a media library and series automation with a TV-first interface. It ships no indexers or content: you connect the sources you are allowed to use.

## Status

Early development. Nothing here is ready for use yet.

## Development

Requires Node.js 24 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
```

Streaming needs the torrent engine ([rqbit](https://github.com/ikatson/rqbit)). `pnpm dev` downloads the pinned release for your platform into the server data folder on first start and verifies its checksum; offline, the server starts without it. To install it separately:

```bash
pnpm --filter @torsher/server engine:install
```

To use your own binary instead, set `RQBIT_PATH` in `apps/server/.env`.

## Contributing

Issues and bug reports are welcome. Pull requests to this repository are not accepted.

## License

[AGPL-3.0-only](LICENSE) © 2026-present, [Anton Reshetov](https://github.com/antonreshetov)
