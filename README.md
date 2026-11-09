# RRS37-Dashboard

Local infoboard for *My Home** — Shelly BLU H&T sensors, Open-Meteo weather, live Public train departures, Photovoltaik (battery SoC, solar W, house W), and Smarthome (covers, LEDVANCE lamps, plugs / FSAPI radios).

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

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The dev server only listens on localhost, so it isn't reachable from the LAN.

## Production deploy

Build runs **on the webserver** (no image registry). The app joins the existing external Docker network `proxy` and is reached as `rrs37b-dashboard:3000` from the reverse-proxy stack.

### One-time setup on the server

1. Install Docker + Compose, clone into `/srv/stacks/rrs37b-dashboard`:

   ```bash
   git clone git@github.com:YOU/RRS37-Dashboard.git /srv/stacks/rrs37b-dashboard
   cd /srv/stacks/rrs37b-dashboard
   ```

2. Copy env and fill RPC password, lat/lon, BVG stops (and PV keys when ready). Shelly devices go into `config/smarthome.yml` (see [Config (YAML file)](#config-yaml-file)):

   ```bash
   cp .env.example .env
   $EDITOR .env
   ```

3. Add the Caddy/nginx snippet and proxy env vars; upstream is `rrs37b-dashboard:3000` on network `proxy`:

   - Caddy: `docs/Caddyfile.example`
   - nginx: `docs/nginx.example.conf`

   The app sends CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy` and `Permissions-Policy` itself (`next.config.ts`); the proxy only adds HSTS. The containers run with a read-only root filesystem, no capabilities, `no-new-privileges` and memory limits (`docker-compose.yml`).

4. Point DNS A/AAAA for `rrs37b.mewes-im-netz.de` at the server.

### Every deploy

Push (or merge) to `main` — GitHub Actions SSHs into the server and runs `./deploy.sh`.

You can also deploy manually on the server:

```bash
cd /srv/stacks/rrs37b-dashboard
./deploy.sh
```

`deploy.sh` does `git pull --ff-only`, `docker compose build`, and `docker compose up -d`. If `GROWATT_USERNAME` is set in `.env.noah`, it also starts the `noah` Compose profile (Mosquitto + noah-mqtt). Check with `docker compose ps` and open `https://rrs37b.mewes-im-netz.de`.

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
2. Ensure `/srv/stacks/rrs37b-dashboard` can `git pull` from GitHub non-interactively.
3. User must be able to run `docker compose` (e.g. membership in the `docker` group).

## Environment

See `.env.example`. Never commit `.env` (repo is public).

| Variable | Purpose |
|----------|---------|
| `AUTH_SECRET` | Signs the session cookie (`openssl rand -hex 32`) |
| `ACCESS_TOKENS` | Comma-separated unlock codes, max 5, each ≥ 24 characters (shorter ones are ignored). Removing a code logs out the devices that used it |
| `SESSION_EPOCH` | Optional. Change to any new value to log out every device. Sessions last 14 days since last use |
| `SHELLY_RPC_PASSWORD` | Fallback RPC password for Shelly devices without `password` in the YAML |
| `TAPO_EMAIL` / `TAPO_PASSWORD` | Tapo app account for plugs with `vendor: tapo` (local KLAP handshake only). On firmware ≥1.4 enable **Third-Party Compatibility** in the app (Me → Third-Party Services); toggle off/on if handshake still returns 403 |
| `SMARTHOME_CONFIG_FILE` | Optional path to Smarthome YAML (default `config/smarthome.yml`) |
| `GIRA_BLE_API_URL` | gira-ble-api base URL for the Heizung tab |
| `GIRA_BLE_API_TOKEN` | Optional Bearer token for the heating proxy |
| `OPEN_METEO_LAT` / `LON` | Fixed coords for 37B (`52.565379` / `13.441779`) |
| `BVG_STOP_*` | Stop IDs/labels; 1+2 = default two-column Zuhause, 3+ = picker options |
| `APSYSTEMS_EZ1_HOST` | EZ1-M LAN IP — solar production (`p1 + p2`) |
| `NOAH_MQTT_URL` | MQTT broker for NOAH SoC (e.g. `mqtt://mosquitto:1883`) |
| `NOAH_MQTT_PASSWORD` | Read-only broker account `dashboard` (required with profile `noah`) |
| `GROWATT_USERNAME` / `PASSWORD` | Growatt account for noah-mqtt — in `.env.noah`, never `.env` |
| `MQTT_PASSWORD` | Read/write broker account `noah` — in `.env.noah` |

## Repo layout

```dir
app/                 # UI + route handlers
components/
lib/
  shelly.ts          # LAN RPC → BLU sensors
  smarthome.ts       # Cover / lamp / plug status + control
  smarthome-config.ts
  heating.ts         # Gira thermostat snapshot + setpoint
  gira-ble.ts        # gira-ble-api HTTP client
  light-mode.ts      # Lamp cycle helpers (shared with UI)
  tuya-light.ts      # LEDVANCE / Tuya local (tuyapi)
  tapo-plug.ts       # Tapo P100 local KLAP (vendor: tapo)
  fsapi-power.ts     # Frontier Silicon FSAPI power (vendor: fsapi)
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

Discovery returns gateway IPs and BLE MACs, so it is off by default. Set `ENABLE_DISCOVERY=1` in `.env`, restart or redeploy, then open `/api/sensors/discover` in a browser where the dashboard is unlocked. Remove the variable again when you're done.

The gateways are listed under `plugs` (with `hidden: true`) and the sensors under `sensors` in `config/smarthome.yml`. Discovery queries every gateway referenced by a sensor. Copy each device `mac` into the matching sensor entry:

```yaml
sensors:
  - label: Aussen
    gateway: gw-aussen-arbeit
    mac: ...
```

Live values: `GET /api/sensors` (45s TTL cache).

## Photovoltaik

Tab **Photovoltaik** shows Batterie SoC (NOAH), Erzeugung (EZ1-M), Hausverbrauch (Pro 3EM), and Saldo when both power readings exist. All device calls are server-side (`GET /api/pv`, ~30s TTL).

### 1. Shelly Pro 3EM (house W)

Add it under `meters` in `config/smarthome.yml` (the first meter is used):

```yaml
meters:
  - id: pro3em
    ip: 192.168.x.y
    emId: 0              # optional; default 0
    password: "…"        # optional, else SHELLY_RPC_PASSWORD
```

Uses the existing Shelly Gen2 RPC client (`EM.GetStatus` → `total_act_power`).

If a Growatt NOAH uses the same Pro 3EM as its smart meter (Smart Self-Consumption), keep Shelly authentication **off** and set no `password`. The NOAH reads the meter locally without credentials: with authentication on, switching to Smart Self-Consumption fails with "Set failed" in ShinePhone, and its retries put the meter into auth backoff (HTTP 429), which also blocks the dashboard. The meter has no relay, so the exposure is read access and its settings on the LAN.

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

- **Mosquitto** on the `mqtt` network, which is `internal` (no route out of the host)
- **noah-mqtt** (`ghcr.io/mtrossbach/noah-mqtt`) which polls Growatt and publishes JSON to `noah2mqtt/{serial}` (field `soc`). It is also on the `egress` network to reach the Growatt cloud.

The Growatt credentials go into a separate `.env.noah` on the server, which only the `noah-mqtt` container reads. Never put them in `.env`: the dashboard container loads all of `.env`, and `deploy.sh` refuses to deploy if they are there.

The broker requires a login. noah-mqtt also accepts commands on `noah2mqtt/{serial}/parameters/set` (charge/discharge limits, output power), so the ACL in `deploy/mosquitto/acl` gives the `noah` account read/write and the `dashboard` account read-only access. Set one password per account; `deploy.sh` refuses to deploy the `noah` profile without them and writes them to `.env.mosquitto` for the broker, which hashes them at startup.

```bash
cp .env.noah.example .env.noah && chmod 600 .env.noah
echo "MQTT_PASSWORD=$(openssl rand -hex 24)" >> .env.noah
echo "NOAH_MQTT_PASSWORD=$(openssl rand -hex 24)" >> .env
```

```env
# .env.noah
GROWATT_USERNAME=your-growatt-user
GROWATT_PASSWORD=your-growatt-password
MQTT_PASSWORD=…
```

```env
# .env
GROWATT_API_MODE=web
NOAH_MQTT_URL=mqtt://mosquitto:1883
NOAH_MQTT_TOPIC=noah2mqtt/+
NOAH_MQTT_PASSWORD=…
```

Both sidecar images (`eclipse-mosquitto`, `noah-mqtt`) are pinned by digest in `docker-compose.yml`. To update, look up the new tag's digest and change it there deliberately.

Redeploy:

```bash
./deploy.sh
# or manually:
# COMPOSE_PROFILES=noah docker compose up -d
```

`deploy.sh` turns on profile `noah` automatically when `GROWATT_USERNAME` is set in `.env.noah`. The dashboard keeps a short-lived MQTT subscriber in-process and reads appliance SoC (plus charge/discharge W when present).

Pin a single device if you have several:

```env
NOAH_MQTT_TOPIC=noah2mqtt/0ABC00AA15AA00AA
```

## Heizung

Tab **Heizung** (radiator icon in the tab strip; session required) talks to a LAN **gira-ble-api** proxy for Gira System 3000 thermostats. The browser never calls the proxy (no CORS) — only Next.js Route Handlers do.

| Env | Purpose |
|-----|---------|
| `GIRA_BLE_API_URL` | Proxy base URL, e.g. `http://192.168.123.124:8787` |
| `GIRA_BLE_API_TOKEN` | Bearer token when the proxy has `api_tokens` set |

Floor layout lives in the same `config/smarthome.yml` as rollers — add a top-level `thermostats` list. `group` may reuse cover floor ids (`dg`, `og`, …); `id` must match gira-ble-api. Gira covers (5367xx) use the same proxy under `covers:` with `vendor: gira` (Rollos tab, not Heizung).

```yaml
thermostats:
  - id: dg-office
    name: Arbeitszimmer   # optional display override
    group: dg             # same id as the Dachgeschoss cover group
    group_primary: true   # optional; Ist on collapsed floor header (≤1 per group)
```

| Endpoint | Purpose |
|----------|---------|
| `GET /api/heating` | Floor-grouped snapshot (Ist/Soll/online/paired/`last_seen_at`) |
| `POST /api/heating/setpoint` | `{ id, celsius }` — BLE write (~5–60s); UI shows pending and blocks double-submit |

Empty floors (no live thermostats) and ids not listed in YAML are hidden. Unpaired rooms show a muted Bluetooth icon and disabled ± controls.

## Smarthome

Tab **Smarthome** (session required, same unlock as the rest of the dashboard):

- Roller shutters (Shelly 2PM Cover and Gira System 3000 covers via gira-ble-api) — ↑ / ↓ controls (active direction becomes pause/stop while moving); groups with no covers are hidden
- LEDVANCE Smart+ WiFi lamps (Tuya local) — one cycle button per lamp/group: **off → on → dim → off** (mixed → on); groups with no lamps are hidden
- Power toggles under **Smarthomegeräte** (Shelly Plug S, Tapo P100, FSAPI radios such as Hama IR110)

Device traffic is server-side (`lib/smarthome.ts` → Shelly RPC, gira-ble-api, Tapo KLAP, FSAPI HTTP, or Tuya/`tuyapi`). The browser never sees device IPs or `local_key` — only config ids (`groupId` / `coverId` / `lampId` / `plugId`).

| Endpoint | Purpose |
|----------|---------|
| `GET /api/smarthome` | Status (short TTL cache, ~8s) — `groups` (covers), `lightGroups`, `plugs` |
| `POST /api/smarthome/group` | `{ groupId, action: open\|stop\|close }` — cover groups; partial failures → HTTP 207 |
| `POST /api/smarthome/cover` | `{ coverId, action: open\|stop\|close }` |
| `POST /api/smarthome/light` | `{ lampId }` — cycle one lamp |
| `POST /api/smarthome/light-group` | `{ groupId }` — cycle all lamps in a light group to the same next mode |
| `POST /api/smarthome/plug` | `{ plugId, on: boolean }` |

Control commands always hit devices live and invalidate the status cache. Without a valid session, `proxy.ts` returns 401 on these routes (same as sensors/PV).

Keep the LEDVANCE Smart+ app closed while using local control — Tuya devices allow only one TCP session.

### Config (YAML file)

Devices live in YAML (not `.env`): untyped groups (floors/rooms), covers, lamps, plugs, BLE gateways, BLU sensors, the Pro 3EM, and Gira thermostats. Each tab only shows groups that have matching devices.

```bash
cp config/smarthome.example.yml config/smarthome.yml
$EDITOR config/smarthome.yml
```

`config/smarthome.yml` is gitignored and excluded from the Docker image. Schema (see the example file for comments):

```yaml
groups:
  - id: dg
    name: Dachgeschoss   # shared by covers + thermostats
  - id: wohn
    name: Wohnbereich
covers:
  - id: dg-ost
    name: DG Ost
    ip: 192.168.x.x
    coverId: 0
    group: dg
    password: "…"        # optional, else SHELLY_RPC_PASSWORD
  - id: eg-living-blind
    name: Wohnzimmer Jalousie
    vendor: gira         # Gira 5367xx via GIRA_BLE_API_URL; no ip/password
    group: eg
lamps:
  - id: stehlampe
    name: Stehlampe
    ip: 192.168.x.x
    device_id: "bf…"     # Tuya device id
    local_key: "…"       # Tuya local key (server secret)
    group: wohn
    on_percent: 100      # optional, default 100
    dim_percent: 70      # optional — omit to turn off on group/lamp dim
    # protocol: "3.5"    # optional, default 3.5
plugs:
  - id: plug-1
    name: Shelly Plug S
    ip: 192.168.x.x
    switchId: 0          # vendor: shelly is the default
  - id: tapo-1
    name: Tapo P100
    ip: 192.168.x.x
    vendor: tapo         # uses TAPO_EMAIL / TAPO_PASSWORD
  - id: radio-kueche
    name: Küchenradio
    vendor: fsapi        # Frontier Silicon / UNDOK (e.g. Hama IR110)
    ip: 192.168.x.x
    # pin: "1234"        # optional NetRemote PIN (default 1234)
    # port: 80           # optional HTTP port (default 80; some use 2244)
  - id: gw-wohnzimmer
    name: Gateway Wohnzimmer
    ip: 192.168.x.x
    hidden: true         # Shelly BLE gateway — not shown, not switchable
sensors:
  - label: Wohnzimmer    # Aussen | Arbeitszimmer | Wohnzimmer
    gateway: gw-wohnzimmer
    mac: aa:bb:cc:dd:ee:ff
meters:
  - id: pro3em           # first meter = Hausverbrauch
    ip: 192.168.x.x
    emId: 0
```

- `id` values must be unique within each list; sensor labels must be unique.
- Groups are untyped (`id` + `name` only). Do not nest devices under groups — use top-level `covers` / `lamps` / `thermostats` with `group: <id>`. A leftover `type:` on a group is ignored (logged once).
- `coverId` / `switchId` / `emId` default to `0` when omitted.
- Cover `vendor` is `shelly` (default) or `gira`. Gira covers share `GIRA_BLE_API_URL` / `GIRA_BLE_API_TOKEN` with Heizung; `id` must match gira-ble-api `covers[].id`. Do not set `ip` / `coverId` / `password` on Gira covers.
- Lamp cycle maps modes to Tuya DPs `20` (on/off) and `22` (brightness 10–1000). On uses `on_percent` (default 100). Dim uses each lamp’s `dim_percent`; if omitted, that lamp turns **off** on dim (useful in mixed groups). A single lamp without `dim_percent` cycles off → on → off.
- Plug `vendor` is `shelly` (default), `tapo`, or `fsapi`. Sensor `gateway` plugs must be Shelly (Tapo/FSAPI as gateway is a config error).
- `password` is optional on Shelly covers, plugs and meters. Without it, `SHELLY_RPC_PASSWORD` is used; the server log lists which devices still fall back. Entries sharing an IP must not have different passwords. Do not set `password` on Tapo or FSAPI plugs.
- FSAPI entries (`vendor: fsapi`) are power on/off only (same UI toggle as plugs). Optional `pin` (default `1234`) and `port` (default `80`).
- Empty groups are hidden per tab (no covers → no Rollo section; no lamps → no Lampen section; no live thermostats → no Heizung floor). Unknown `group` or `gateway` references are config errors.
- Optional path override: `SMARTHOME_CONFIG_FILE` (Compose sets `/app/config/smarthome.yml`).
- If the live file is missing, the tab shows `config/smarthome.example.yml` (no LAN probes; control, sensors and Hausverbrauch disabled).

#### Hama IR110 / FSAPI radio

Hama IR110 (and other Frontier Silicon / UNDOK radios) are controlled over **local LAN HTTP (FSAPI)**, not cloud. Add them under `plugs` with `vendor: fsapi`. v1 supports power on/off only (`netRemote.sys.power`).

On the radio, enable:

- **MENU → System settings → Network → Keep network connected → Yes** — otherwise Wi‑Fi drops in standby and remote power-on fails.
- Note the **NetRemote PIN** under **MENU → System settings → Network → NetRemote PIN Setup** (often default `1234`; set `pin` in YAML if changed).

Sanity-check from a host on the same LAN: `http://<IP>/fsapi/GET/netRemote.sys.power?pin=1234` (or `http://<IP>:2244/...` if the device uses port 2244 — then set `port: 2244`).

#### LEDVANCE / Tuya keys

Pair bulbs in the Smart+ app first, reserve stable DHCP IPs, then export `device_id` + `local_key` (e.g. `npx @tuyapi/cli wizard` with a Tuya IoT project, `python -m tinytuya wizard`, or a Ledvance-oriented key dump such as FlagX `print-local-keys`). Put them only in `config/smarthome.yml` — never commit real `local_key` values. After a re-pair or firmware reset the local key changes and must be updated. Redeploy is not required for YAML edits (bind-mounted `./config`); a rebuild is only needed when app code changes.

Since the file can hold passwords and Tuya keys, restrict it on the server to the deploy user and the container user (`node`, UID 1000), e.g. `chown <deploy-user>:1000 config/smarthome.yml && chmod 640 config/smarthome.yml`.

Docker mounts `./config` into the container; edits are picked up on the next request without a redeploy.
