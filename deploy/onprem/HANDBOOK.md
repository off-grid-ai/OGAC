# Off Grid — On-Prem Fleet Handbook

Operator runbook for the 5-MacBook on-prem deployment. **What runs where, how to check
it's healthy, and how to fix it.** Everything is on the office LAN — nothing is exposed to
the internet (by design).

---

## 1. What runs where

5 × 16 GB Apple-Silicon MacBooks. **Reach every node by its stable mDNS name** (`*.local`) —
those survive IP changes; the IPs below are current but can shift on a network change.

| Node (mDNS) | IP (current) | Role | Runs |
|---|---|---|---|
| **offgrid-s1** | 127.0.0.1 | **Server / control plane** | Caddy edge (:80), Postgres (:5432), Keycloak (:8080), aggregator (:8800), metrics (:9100), Console (:3000) |
| **offgrid-s2** | 192.168.1.60 | Server (console standby) | Console (:3000) — shares S1's Postgres |
| **offgrid-g1** | 192.168.1.57 | Gateway · inference | Gemma 4 12B *(migrating from Qwen 3.5 9B)* — text/general |
| **offgrid-g2** | 192.168.1.58 | Gateway · inference | Qwen 3.5 9B — **text + vision** (mmproj) |
| **offgrid-g3** | 192.168.1.32 | Gateway · inference | Gemma 4 E4B — **vision** |

All nodes: user `admin`, password `1234` (LAN-only; change before any exposure), key-based
SSH + passwordless sudo. **Sleep is disabled** (`pmset disablesleep 1`) so lids can stay closed.

---

## 2. URLs & access

| What | URL | Notes |
|---|---|---|
| **Console** | http://127.0.0.1 | The one IP. Also `http://onprem-console.getoffgridai.co` on fleet Macs (via /etc/hosts). |
| **Metrics dashboard** | http://127.0.0.1:9100 | Live CPU/mem/disk/load per node. |
| **Gateway (aggregator)** | http://127.0.0.1:8800/v1 | OpenAI-compatible; routes text→g1/g2, images→g2/g3. |
| **Keycloak** | http://127.0.0.1:8080 | Realm `offgrid`. Admin: `admin` / `offgrid-dev`. |

**Console login (Keycloak):** `mac@`, `mohammed.ali@`, `diksha.sharma@`, `ali@wednesday.is` — password `OffGrid-2026`. Locked to `@wednesday.is`. *Use a fresh/incognito window after any restart (stale session cookies).*

---

## 3. Services (how each stays up)

**S1 — LaunchDaemons (root, `/Library/LaunchDaemons/`):**
- `co.getoffgridai.edge` → native Caddy on :80 (console) — config `~/offgrid/console/deploy/Caddyfile`
- `co.getoffgridai.aggregator` → gateway router on :8800 — `scripts/gateway-aggregator.mjs`
- `co.getoffgridai.metrics` → metrics dashboard on :9100 — `scripts/metrics-dashboard.mjs`

**S1 & S2 — LaunchAgent (user, `~/Library/LaunchAgents/`):**
- `co.getoffgridai.console` → `next start` on :3000 (via `start-console.sh`, which sources `.env`)

**g1/g2/g3 — LaunchAgent:**
- `co.getoffgridai.gateway` → Off Grid Desktop `--server-only` on :7878 (env `OFFGRID_DATA_DIR=~/.offgrid`, `LLAMA_ARG_REASONING=off`)

**S1 — OrbStack containers** (`restart: unless-stopped`): `offgrid-console-postgres-1` (:5432), `offgrid-console-keycloak-1` (:8080). OrbStack is a login item (starts on login).

All launchd jobs have `KeepAlive` → auto-restart on crash. The fleet came back cleanly after an overnight; a reboot needs the user logged in (auto-login not set).

---

## 4. Health check

**One command (from the coordinator Mac, in `console/deploy/onprem/`):**
```bash
./recover.sh health      # PASS/FAIL for keycloak, console, gateway pool, end-to-end inference
```
**Live metrics:** open http://127.0.0.1:9100.

**Spot checks:**
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1/signin          # console (200)
curl -s http://127.0.0.1:8800/                                            # aggregator info + gateways
curl -s http://127.0.0.1:8800/v1/models                                   # models available
curl -s http://127.0.0.1:8080/realms/offgrid/.well-known/openid-configuration -o /dev/null -w '%{http_code}\n'  # keycloak (200)
# per-gateway:
for ip in 57 58 32; do curl -s -o /dev/null -w "g.$ip: %{http_code}\n" http://192.168.1.$ip:7878/health; done
```

---

## 5. Fix it

**Bring everything back to known-good (resolves current IPs by name, regenerates config, restarts all):**
```bash
cd console/deploy/onprem && ./recover.sh        # full recover + health report
```

**Restart one service** (SSH to the node first, e.g. `ssh admin@offgrid-s1.local`):
```bash
# root daemons (S1): edge / aggregator / metrics
sudo launchctl kickstart -k system/co.getoffgridai.edge
# user agents: console (S1/S2), gateway (g1/g2/g3)
launchctl kickstart -k gui/$(id -u)/co.getoffgridai.console
launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway
# containers (S1)
cd ~/offgrid/console/deploy && docker compose --profile data --profile identity up -d postgres keycloak
```

**Logs:** `/tmp/offgrid-edge.log`, `/tmp/offgrid-aggregator.log`, `/tmp/offgrid-metrics.log`, `~/offgrid/console/deploy/console.log`, `~/gateway.log` (on gateways).

**After a network change** (IPs shifted): `./recover.sh` re-resolves every node by mDNS name and regenerates the edge config, `/etc/hosts`, and console `.env` for the new IPs.

---

## 6. Common ops

**Swap the model on a gateway** (e.g. g1):
```bash
ssh admin@offgrid-g1.local
# 1. download the GGUF (+ mmproj if vision) into ~/.offgrid/models/
# 2. write ~/.offgrid/models/active-model.json:
#    {"id":"<repo>","primary":"<model.gguf>","mmproj":"<mmproj.gguf or null>"}
launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway   # reloads the model
# 3. update the aggregator POOL (scripts/gateway-aggregator.mjs) so /v1/models + routing match
```

**Aggregator routing** (`scripts/gateway-aggregator.mjs`, `POOL`): text → g1/g2 round-robin;
image (or `model:gemma`) → a vision gateway. Restart: `sudo launchctl kickstart -k system/co.getoffgridai.aggregator`.

**Add a gateway (6th+ machine):** enable Remote Login + `ssh-copy-id` the coordinator key + set NOPASSWD sudo; `pmset disablesleep 1`; rsync the Desktop app + place the model; install the gateway LaunchAgent; add its IP to the aggregator `POOL` and (optionally) the `:8800` pool.

---

## 7. Gotchas we hit (so you don't again)

- **Docker/OrbStack containers on macOS can't reach LAN peers** — that's why the edge is *native Caddy*, not a container.
- **rsyncing the Desktop `.app` breaks its code signature** → `codesign --force --deep --sign - "App"` on the node.
- **Split/mismatched `bin/llama` backends** → replace with the complete colocated set from `desktop/resources/bin/llama/`.
- **`next start` doesn't auto-load `.env`** → the console starts via `start-console.sh` which sources it (and sets PATH so `node` is found).
- **Console HA (2 active instances) breaks NextAuth** (differing Server-Action IDs) → console is single-instance (S1); S2 is a warm standby. True HA needs build-once-distribute + shared keys.
- **Qwen 3.5 text quant has no vision** (`mmproj: null`) — vision needs a GGUF that ships an mmproj (g2 Qwen, g3 Gemma).
- **Reasoning models emit empty content** unless `LLAMA_ARG_REASONING=off` (set in the gateway LaunchAgent).

---

## 8. Not exposed to the internet — on purpose

LAN-only behind the router's NAT. For remote demos use a **VPN (Tailscale)** — never port-forward
(`admin/1234` + passwordless sudo would be a takeover risk if reachable). See the deployment memory.
