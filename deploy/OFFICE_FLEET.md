# Off Grid — Office Fleet Deployment (3–4 machines, office WiFi)

Goal: stand up Off Grid on a handful of office laptops so anyone on the office WiFi can
open the **Console** in a browser, and inference runs on a local **Gateway** (Off Grid AI
Desktop without the UI). Everything stays on the LAN — no cloud.

This is a single-org, trusted-LAN setup. It is deliberately simple; the hardening notes at
the end cover what to add before this leaves a trusted network.

---

## 1. Topology — who runs what

You have ~3–4 machines. Assign roles like this (one machine can hold more than one role):

| # | Role | Runs | Listens on | Notes |
|---|------|------|-----------|-------|
| **A** | **Console host** ("the server") | Postgres + Console (Next.js) | `3000` (console), `5432` (pg, local only) | What people open in a browser. Keep it always-on. |
| **B** | **Gateway / inference host** | `offgrid-gateway` (headless desktop) | `7878` | The beefiest machine (most RAM / best GPU). Holds the models. |
| **C, D** | **Client laptops / nodes** | A browser; optionally Off Grid Desktop as an enrolled node | — | People use these. Optionally enrolled into the fleet so they pull policy + push audit. |

Minimum viable = **2 machines** (A = console+pg, B = gateway). With 3–4 you split console
and gateway onto separate boxes and keep one beefy box dedicated to inference.

```
                office WiFi (LAN)
   ┌──────────────┬───────────────────┬──────────────┐
   │              │                   │              │
 [C laptop]    [D laptop]        [A console host]  [B gateway host]
  browser ─────────────────────▶ :3000 Console ───▶ :7878 Gateway
  (+ optional node agent ─────▶ :3000 /api/v1/devices/*)   (models live here)
                                   │
                                   └─▶ :5432 Postgres (same box)
```

---

## 2. Addressing — make the URLs stable on office WiFi

Office WiFi hands out DHCP addresses that change. Pick **one** so bookmarks don't break:

- **Easiest (all-Mac): mDNS / Bonjour `.local` names.** Each Mac is already reachable at
  `<computer-name>.local`. Set clean names in System Settings → General → Sharing → "Local
  hostname". Then use `http://console-host.local:3000` and `http://gateway-host.local:7878`.
  No router config needed.
- **Most robust: DHCP reservations.** In the office router, pin a static lease to machine A
  and B's MAC addresses. Use those IPs everywhere.

Avoid raw rotating DHCP IPs — they will break the console→gateway link and everyone's bookmarks.

---

## 3. Machine A — Console host

### 3.1 Bring up Postgres (and any other licensed capabilities)

```bash
cd console/deploy
make data          # Postgres 16 + pgvector + SeaweedFS (see Makefile profiles)
# add more capabilities as needed, e.g.:  make secrets  make observability
```

Postgres comes up on `5432` with a persistent volume (`pgdata`). Keep `5432` bound to the
host only — the console talks to it locally; nothing else on the LAN should reach it.

### 3.2 Configure and start the Console

Create `console/.env` (or `.env.local`):

```bash
# datastore (matches the compose default)
DATABASE_URL=postgresql://offgrid@localhost:5432/offgrid_console

# session signing — generate once: openssl rand -base64 32
AUTH_SECRET=<paste-generated-secret>
NODE_ENV=production

# where the gateway lives — POINT THIS AT MACHINE B (see §4)
OFFGRID_GATEWAY_URL=http://gateway-host.local:7878

# which modules people see (omit to show all). Example: fleet + control + gateway + agents
# NEXT_PUBLIC_OFFGRID_MODULES=fleet,control,gateway,agents

# ---- AUTH: pick ONE (see §6) ----
# Quick start on a trusted LAN ONLY — anyone who reaches :3000 is in:
AUTH_DEV_LOGIN=true
# Real multi-user SSO instead: configure Keycloak / Google / Entra (see §6)
```

Initialize the schema and run it, **bound to all interfaces** so the LAN can reach it:

```bash
cd console
npm ci
npm run db:push          # apply Drizzle schema to Postgres
npm run db:seed          # optional starter data
npm run build
npx next start -H 0.0.0.0 -p 3000
```

> The default `npm start` binds localhost only. The `-H 0.0.0.0` is what makes it reachable
> from other machines on the WiFi. (For an always-on service, wrap this in a `launchd`
> plist or run it under `pm2`/`forever` so it survives logout/reboot.)

People now open **`http://console-host.local:3000`**.

---

## 4. Machine B — Gateway (Off Grid AI Desktop, headless)

The gateway is the same codebase as Off Grid AI Desktop, run without the Electron UI. It's
OpenAI-compatible on `7878`.

### 4.1 Provision models + platform binaries

The gateway needs two directories on this box:

- `OFFGRID_DATA_DIR` — writable dir holding **models**, caches, generated output.
- `OFFGRID_BIN_DIR` — dir holding the platform binaries: `llama-server`, `sd-cli`,
  `whisper`, `ffmpeg`. (Copy these from a working Desktop install on this same OS/arch.)

### 4.2 Run it bound to the LAN

```bash
OFFGRID_DATA_DIR=~/.offgrid \
OFFGRID_BIN_DIR=/opt/offgrid/bin \
OFFGRID_GATEWAY_PORT=7878 \
npx @offgrid/gateway
# → serves on :7878  (OpenAI-compatible: /v1/chat/completions, /v1/models, /healthz)
```

Or via Docker:

```bash
docker run -p 7878:7878 \
  -v /models:/data/models -v /opt/offgrid/bin:/bin/offgrid \
  -e OFFGRID_DATA_DIR=/data -e OFFGRID_BIN_DIR=/bin/offgrid \
  ghcr.io/off-grid-ai/gateway
```

> **Bind check:** the README examples show `127.0.0.1:7878` (localhost only). For the
> console on machine A to reach it across the WiFi, the gateway must bind `0.0.0.0`. If the
> current build only binds localhost, either (a) run it inside Docker with `-p 7878:7878`
> (which publishes on all host interfaces), or (b) front it with a tiny reverse proxy
> (`caddy reverse-proxy --from :7878 --to 127.0.0.1:7878` on a second port). Confirm with
> `curl http://gateway-host.local:7878/healthz` from machine A.

### 4.3 ⚠️ Status caveat — read before you expect chat to work

The standalone gateway is **v0.1**: per its README it currently exposes only `/healthz` and
`/v1/models`. The real inference handlers (chat / vision / image / audio / embeddings) are
**still migrating out of the Desktop runtime** into the standalone server. Until that lands:

- The Console's Gateway page and `/v1/models` will work (you'll see the box is alive).
- Actual `/v1/chat/completions` may not serve yet from the standalone CLI.

**Practical path today:** run **full Off Grid AI Desktop** on machine B (it embeds the same
gateway in-process and *does* serve inference), and point `OFFGRID_GATEWAY_URL` at that box.
When the standalone handlers finish migrating, swap to the headless CLI/Docker with no
console-side change. Verify with:

```bash
curl http://gateway-host.local:7878/v1/models
curl -s http://gateway-host.local:7878/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"<id-from-/v1/models>","messages":[{"role":"user","content":"ping"}]}'
```

---

## 5. Machines C / D — the people using it

Two ways to participate, not mutually exclusive:

1. **Browser only (zero install).** Open `http://console-host.local:3000`, log in, use the
   console. This is all most people need.

2. **Enrolled node (optional).** If you want a laptop tracked in the fleet (pulls policy,
   pushes audit, killable from the console), enroll it:
   - In the console (or via API), an admin mints a one-time enrollment token:
     `POST /api/v1/admin/enroll-token` → `{ token, role }`.
   - The device trades it for an identity + device token:
     ```
     POST http://console-host.local:3000/api/v1/devices/enroll
     { "token": "<enrollment-token>", "name": "Alice-MBP", "os": "macOS" }
     → { device: {...}, deviceToken: "dt_<id>" }
     ```
   - The node then periodically: `GET /devices/<id>/policy`, `POST /devices/<id>/audit`,
     `GET /devices/<id>/commands` (kill / re-provision). These node routes are public-by-token
     (no SSO), so they work from any laptop on the WiFi.

Point each node's gateway URL at machine B as well, so on-device features that fall back to a
shared gateway hit the inference box.

---

## 6. Auth — who can log in

The console uses NextAuth (JWT sessions). Pick based on how locked-down you need it:

| Option | Setup | Use when |
|--------|-------|----------|
| **Dev login** (`AUTH_DEV_LOGIN=true`) | nothing | Fastest. Trusted office LAN, small team, you trust everyone on the WiFi. **Never expose beyond the LAN.** |
| **Keycloak** | already in `make identity` compose profile; set `AUTH_KEYCLOAK_ID/SECRET/ISSUER` (e.g. `http://console-host.local:8080/realms/offgrid`) | Real multi-user, self-hosted, no external dependency. Recommended for the office. |
| **Google / Entra** | `AUTH_GOOGLE_ID/SECRET` (or Entra equivalents) | Your org already uses Google/Microsoft and you want those identities. Note: OAuth redirect URIs over plain `http://*.local` are fiddly — Keycloak avoids that. |

Admin API automation can also use `Authorization: Bearer $OFFGRID_ADMIN_TOKEN`.

---

## 7. Firewall — let the LAN in

macOS firewall (System Settings → Network → Firewall) blocks inbound by default. On the
hosts, allow inbound for the listening processes:

- **Machine A:** allow inbound `3000` (console). Keep `5432` host-local (don't open it).
- **Machine B:** allow inbound `7878` (gateway).

If the firewall is on, you'll get prompted to "allow incoming connections" for `node` /
`docker` the first time — accept on A and B. Clients (C/D) need no inbound rules.

---

## 8. Bring-up order & quick verification

1. **A:** `make data` → Postgres healthy (`docker compose ps`).
2. **A:** `db:push` + `db:seed` → `npx next start -H 0.0.0.0 -p 3000`.
3. **B:** start gateway (or full Desktop) → `curl …:7878/healthz` from **A** succeeds.
4. **A:** set `OFFGRID_GATEWAY_URL=http://gateway-host.local:7878`, restart console.
5. **C/D:** browser → `http://console-host.local:3000`, log in, open the Gateway page → it
   should list models from B.
6. (Optional) enroll C/D as nodes; confirm they appear under Fleet with a recent `lastSeen`.

---

## 9. Before this leaves a trusted LAN (hardening checklist)

The above is fine for a trusted office network. Add these before any wider exposure:

- [ ] Turn **off** `AUTH_DEV_LOGIN`; require real SSO (Keycloak/Google/Entra).
- [ ] **TLS** — front the console (and gateway) with Caddy + `mkcert` (LAN-trusted certs) or
      real certs; serve over `https`. Some browser features and OAuth prefer https.
- [ ] Run console + gateway as **managed services** (launchd / pm2 / Docker `restart: unless-stopped`)
      so they survive reboot/logout. Don't rely on a terminal staying open.
- [ ] **Back up Postgres** (`pg_dump` on a cron) — devices, policies, and the immutable audit
      log all live there.
- [ ] Rotate `AUTH_SECRET` and `OFFGRID_ADMIN_TOKEN`; store secrets in OpenBao (`make secrets`)
      rather than plaintext `.env`.
- [ ] Lock the node API routes behind the office network only (they're token-auth, but
      public by design) — don't port-forward `3000` to the internet.
- [ ] Decide `NEXT_PUBLIC_OFFGRID_MODULES` so people only see the modules you've turned on.

---

## TL;DR

- **A** = Postgres + Console (`npx next start -H 0.0.0.0 -p 3000`).
- **B** = Gateway = Off Grid Desktop headless (`offgrid-gateway`, `:7878`, bind `0.0.0.0`,
  holds the models). Today run full Desktop here until standalone inference handlers land.
- **C/D** = browsers (and optionally enrolled fleet nodes).
- Use `.local` hostnames or DHCP reservations so URLs stay put, open `3000` and `7878` on the
  firewall, point `OFFGRID_GATEWAY_URL` at B, and start with `AUTH_DEV_LOGIN` then move to
  Keycloak.
