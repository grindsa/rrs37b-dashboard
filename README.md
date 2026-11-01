# RRS37-Dashboard

Local infoboard for **Romain-Rolland-Straße 37B, Berlin** — Shelly BLU H&T sensors, Open-Meteo weather, and live BVG departures.

Public site (planned): `https://rrs37b.mewes-im-netz.de`

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **Docker Compose** on your own webserver (build on the server, no registry)
- Reverse proxy: **nginx** or **Caddy** (example configs in `docs/`)
- No database in MVP; in-memory TTL cache in the Node process

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production deploy

On the webserver (Docker + Compose required):

```bash
cp .env.example .env   # once — fill secrets / IPs / lat-lon
./deploy.sh
```

`deploy.sh` pulls `main`, builds the image, and restarts the container on `127.0.0.1:3000`.

Point your reverse proxy at that port:

- `docs/nginx.example.conf`
- `docs/Caddyfile.example`

## Environment

See `.env.example`. Never commit `.env` (repo is public).

| Variable | Purpose |
|----------|---------|
| `SHELLY_PLUG_*` | LAN IPs of Plug S Gen3 BLE gateways |
| `SHELLY_RPC_PASSWORD` | RPC auth (set when enabling on the plugs) |
| `OPEN_METEO_LAT` / `LON` | Fixed coords for 37B |
| `BVG_STOP_*` | Stop IDs and labels for the 30‑minute window |

## Repo layout

```
app/                 # UI + route handlers
components/
lib/
  shelly.ts          # LAN RPC → sensors
  weather.ts         # Open-Meteo
  bvg.ts             # transport.rest
  cache.ts           # in-memory TTL
Dockerfile
docker-compose.yml
deploy.sh
docs/                # nginx + Caddy examples
```

## Roadmap

1. ~~Scaffold~~ (this phase)
2. UI with dummy data + theme
3. Shelly LAN adapter
4. Open-Meteo + BVG + cache TTLs
5. RPC password, offline states, polish
