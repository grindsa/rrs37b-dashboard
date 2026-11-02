# RRS37-Dashboard

Local infoboard for **Romain-Rolland-Straße 37B, Berlin** — Shelly BLU H&T sensors, Open-Meteo weather, live BVG departures, Photovoltaik (battery SoC, solar W, house W), and Smarthome (Cover / Plug S).

Public site: `https://rrs37b.mewes-im-netz.de`

## Stack

- **Next.js** (App Router) + TypeScript + Tailwind
- **Docker Compose** on your own webserver (build on the server, no registry)
- Reverse proxy: **nginx** or **Caddy** (example configs in `docs/`)
- Optional Compose profile `noah`: Mosquitto + [noah-mqtt](https://github.com/mtrossbach/noah-mqtt) for Growatt NOAH 2000
- No database in MVP; in-memory TTL cache in the Node process

## Local development

```bash
cp .env.example .env
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production deploy

Build runs **on the webserver** (no image registry). The app joins the existing external Docker network `proxy` and is reached as `rrs37-dashboard:3000` from the reverse-proxy stack.

### One-time setup on the server

1. Install Docker + Compose, clone into `/srv/stacks/rrs37-dashboard`:

```bash
git clone git@github.com:YOU/RRS37-Dashboard.git /srv/stacks/rrs37-dashboard
cd /srv/stacks/rrs37-dashboard
```

2. Copy env and fill LAN IPs, sensor MACs, RPC password, lat/lon, BVG stops (and PV keys when ready):

```bash
cp .env.example .env
$EDITOR .env
```

3. Add the Caddy/nginx snippet and proxy env vars; upstream is `rrs37-dashboard:3000` on network `proxy`:

- Caddy: `docs/Caddyfile.example`
- nginx: `docs/nginx.example.conf`

4. Point DNS A/AAAA for `rrs37b.mewes-im-netz.de` at the server.

### Every deploy

Push (or merge) to `main` — GitHub Actions SSHs into the server and runs `./deploy.sh`.

You can also deploy manually on the server:

```bash
cd /srv/stacks/rrs37-dashboard
./deploy.sh
```

`deploy.sh` does `git pull --ff-only`, `docker compose build`, and `docker compose up -d`. If `GROWATT_USERNAME` is set in `.env`, it also starts the `noah` Compose profile (Mosquitto + noah-mqtt). Check with `docker compose ps` and open `https://rrs37b.mewes-im-netz.de`.

The server must reach Shelly devices and the EZ1-M on the LAN.

### CI deploy (GitHub Actions)

Workflow: `.github/workflows/deploy.yml` (on push to `main` and `workflow_dispatch`).

Add these **repository secrets**:

| Secret | Purpose |
|--------|---------|
| `DEPLOY_HOST` | Webserver hostname or IP |
| `DEPLOY_USER` | SSH user that can run Docker / `deploy.sh` |
| `DEPLOY_SSH_KEY` | Private key (ed25519) for that user |
| `DEPLOY_PORT` | Optional SSH port (default `22`) |

One-time server notes:

1. Install the matching **public** key in that user’s `~/.ssh/authorized_keys`.
2. Ensure `/srv/stacks/rrs37-dashboard` can `git pull` from GitHub non-interactively.
3. User must be able to run `docker compose` (e.g. membership in the `docker` group).

## Environment

See `.env.example`. Never commit `.env` (repo is public).

| Variable | Purpose |
|----------|---------|
| `SHELLY_PLUG_*` | LAN IPs of Plug S Gen3 BLE gateways |
| `SHELLY_RPC_PASSWORD` | RPC auth (shared by BLE plugs, Pro 3EM, covers, Plug S) |
| `SMARTHOME_CONFIG_FILE` | Optional path to Smarthome YAML (default `config/smarthome.yml`) |
| `OPEN_METEO_LAT` / `LON` | Fixed coords for 37B (`52.565379` / `13.441779`) |
| `BVG_STOP_*` | Stop IDs/labels; 1+2 = default two-column Zuhause, 3+ = picker options |
| `SHELLY_PRO_3EM_HOST` | Pro 3EM LAN IP — house consumption (`total_act_power`) |
| `APSYSTEMS_EZ1_HOST` | EZ1-M LAN IP — solar production (`p1 + p2`) |
| `NOAH_MQTT_URL` | MQTT broker for NOAH SoC (e.g. `mqtt://mosquitto:1883`) |
| `GROWATT_USERNAME` / `PASSWORD` | Growatt account for noah-mqtt (server `.env` only) |

## Repo layout

```
app/                 # UI + route handlers
components/
lib/
  shelly.ts          # LAN RPC → BLU sensors
  smarthome.ts       # Cover / Plug S status + control
  smarthome-config.ts
  pv.ts              # Photovoltaik orchestrator
  pv-shelly-em.ts    # Pro 3EM house W
  pv-ez1.ts          # EZ1-M solar W
  pv-noah.ts         # NOAH SoC via MQTT
  weather.ts         # Open-Meteo
  bvg.ts             # transport.rest
  cache.ts           # in-memory TTL
config/
  smarthome.example.yml
deploy/
  mosquitto/         # broker config for profile `noah`
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

## Photovoltaik

Tab **Photovoltaik** shows Batterie SoC (NOAH), Erzeugung (EZ1-M), Hausverbrauch (Pro 3EM), and Saldo when both power readings exist. All device calls are server-side (`GET /api/pv`, ~30s TTL).

### 1. Shelly Pro 3EM (house W)

Set in server `.env`:

```env
SHELLY_PRO_3EM_HOST=192.168.x.y
# optional; default 0
SHELLY_PRO_3EM_ID=0
```

Uses the existing Shelly Gen2 RPC client (`EM.GetStatus` → `total_act_power`). Same `SHELLY_RPC_PASSWORD` as the plugs when auth is enabled.

### 2. APsystems EZ1-M Local API (solar W)

Local HTTP is **off by default**. Enable it once in **AP EasyPower**:

1. Connect to the EZ1-M via Bluetooth (direct connection).
2. If **Settings → Local Mode** is missing, sign out of the APsystems cloud account in the app and reconnect over Bluetooth only.
3. Open **Settings → Local Mode**, turn **Enable Local Mode** on, set level to **Continuously**.
4. Note the inverter LAN IP shown in the app.

Then set:

```env
APSYSTEMS_EZ1_HOST=192.168.x.y
# optional; default 8050
APSYSTEMS_EZ1_PORT=8050
```

The dashboard calls `GET http://<IP>:8050/getOutputData` and sums `p1 + p2` (W). If Local Mode is off or the host is unreachable, the PV tab shows a warning and leaves Erzeugung as `—`.

Quick check from the server:

```bash
curl -s "http://$APSYSTEMS_EZ1_HOST:8050/getOutputData"
```

### 3. Growatt NOAH 2000 (SoC via noah-mqtt)

NOAH has no clean local API. The Compose profile `noah` runs:

- **Mosquitto** on the internal `pv` network
- **noah-mqtt** (`ghcr.io/mtrossbach/noah-mqtt`) which polls Growatt and publishes JSON to `noah2mqtt/{serial}` (field `soc`)

On the server `.env` (never commit):

```env
GROWATT_USERNAME=your-growatt-user
GROWATT_PASSWORD=your-growatt-password
GROWATT_API_MODE=web

NOAH_MQTT_URL=mqtt://mosquitto:1883
NOAH_MQTT_TOPIC=noah2mqtt/+
```

Redeploy:

```bash
./deploy.sh
# or manually:
# COMPOSE_PROFILES=noah docker compose up -d
```

`deploy.sh` turns on profile `noah` automatically when `GROWATT_USERNAME` is set. The dashboard keeps a short-lived MQTT subscriber in-process and reads appliance SoC (plus charge/discharge W when present).

Pin a single device if you have several:

```env
NOAH_MQTT_TOPIC=noah2mqtt/0ABC00AA15AA00AA
```

## Smarthome

Tab **Smarthome** (session required, same unlock as the rest of the dashboard):

- Roller shutters (Shelly 2PM Cover) grouped by floor — ↑ / ↓ controls (active direction becomes pause/stop while moving)
- One or more Shelly Plug S toggles

All Shelly traffic is server-side (`lib/smarthome.ts` → `shellyRpc`). The browser never sees device IPs in control requests — only config ids (`groupId` / `coverId` / `plugId`).

| Endpoint | Purpose |
|----------|---------|
| `GET /api/smarthome` | Status (short TTL cache, ~8s) |
| `POST /api/smarthome/group` | `{ groupId, action: open\|stop\|close }` — parallel per cover; partial failures → HTTP 207 |
| `POST /api/smarthome/cover` | `{ coverId, action: open\|stop\|close }` |
| `POST /api/smarthome/plug` | `{ plugId, on: boolean }` |

Control commands always hit devices live and invalidate the status cache. Without a valid session, `proxy.ts` returns 401 on these routes (same as sensors/PV).

### Config (YAML file)

Device layout lives in YAML (not `.env`). RPC password stays in `.env` as `SHELLY_RPC_PASSWORD`.

```bash
cp config/smarthome.example.yml config/smarthome.yml
$EDITOR config/smarthome.yml
```

`config/smarthome.yml` is gitignored. Schema (see the example file for comments):

```yaml
groups:
  - id: dg
    name: Dachgeschoss
    covers:
      - id: dg-ost
        name: DG Ost
        ip: 192.168.x.x
        coverId: 0
plugs:
  - id: plug-1
    name: Shelly Plug S
    ip: 192.168.x.x
    switchId: 0
```

- `id` values must be unique across groups, covers, and plugs.
- `coverId` / `switchId` default to `0` when omitted.
- Optional path override: `SMARTHOME_CONFIG_FILE` (Compose sets `/app/config/smarthome.yml`).
- If the live file is missing, the tab shows `config/smarthome.example.yml` (no LAN probes; control disabled).

Docker mounts `./config` into the container. After editing on the server:

```bash
./deploy.sh
```

Phase 2 (later): target %-position via `Cover.GoToPosition`.

## Roadmap

1. ~~Scaffold~~
2. ~~UI with dummy data + theme~~
3. ~~Shelly LAN adapter~~ (pair BTHome devices on the Plugs, then set MACs)
4. ~~Open-Meteo + BVG + cache TTLs~~
5. ~~RPC password, offline states, polish~~
6. ~~Photovoltaik tab + Pro 3EM / EZ1-M / noah-mqtt adapters~~
7. Deploy to `rrs37b.mewes-im-netz.de`
8. ~~Smarthome tab (Cover groups + Plug S)~~ — %-position later
