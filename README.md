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

Build runs **on the webserver** (no image registry). The container listens on `127.0.0.1:3000`; nginx or Caddy terminates TLS.

### One-time setup on the server

1. Install Docker + Compose, clone into `/srv/stacks/rrs37-dashboard`:

```bash
git clone git@github.com:YOU/RRS37-Dashboard.git /srv/stacks/rrs37-dashboard
cd /srv/stacks/rrs37-dashboard
```

2. Copy env and fill LAN IPs, sensor MACs, RPC password, lat/lon, BVG stops:

```bash
cp .env.example .env
$EDITOR .env
```

3. Enable a reverse proxy for `rrs37b.mewes-im-netz.de` → `127.0.0.1:3000`:

- nginx: `docs/nginx.example.conf` (uncomment TLS paths after certbot)
- Caddy: `docs/Caddyfile.example` (auto-TLS when DNS points here)

4. Point DNS A/AAAA for `rrs37b.mewes-im-netz.de` at the server.

### Every deploy

From the Mac: commit + push `main` to GitHub. On the server:

```bash
cd /srv/stacks/rrs37-dashboard
./deploy.sh
```

`deploy.sh` does `git pull --ff-only`, `docker compose build`, and `docker compose up -d`. Check with `docker compose ps` and open `https://rrs37b.mewes-im-netz.de`.

The server must reach the Shelly plugs on the LAN.

## Environment

See `.env.example`. Never commit `.env` (repo is public).

| Variable | Purpose |
|----------|---------|
| `SHELLY_PLUG_*` | LAN IPs of Plug S Gen3 BLE gateways |
| `SHELLY_RPC_PASSWORD` | RPC auth (set when enabling on the plugs) |
| `OPEN_METEO_LAT` / `LON` | Fixed coords for 37B (`52.565379` / `13.441779`) |
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

## Shelly BLU setup

Both Plug S Gen3 gateways must have Bluetooth observer enabled and each BLU H&T added under **BTHome components** (temperature + humidity sensors). Then:

```bash
curl -s http://localhost:3000/api/sensors/discover | jq
```

Copy each device `mac` into `.env`:

```env
SHELLY_SENSOR_AUSSEN=...
SHELLY_SENSOR_ARBEITSZIMMER=...
SHELLY_SENSOR_WOHNZIMMER=...
```

Restart `npm run dev` / redeploy. Live values: `GET /api/sensors` (45s TTL cache).

## Roadmap

1. ~~Scaffold~~
2. ~~UI with dummy data + theme~~
3. ~~Shelly LAN adapter~~ (pair BTHome devices on the Plugs, then set MACs)
4. ~~Open-Meteo + BVG + cache TTLs~~
5. ~~RPC password, offline states, polish~~
6. Deploy to `rrs37b.mewes-im-netz.de`
