# Runbooks — operational procedures

Step-by-step procedures for running the Off Grid Console in production. Each runbook is
self-contained: trigger → steps → verify. Pairs with `OPERATIONS.md` (what each integration is)
and `HOWTO.md` (feature how-tos).

---

## RB-1 · Bring up the stack

**Trigger:** new deployment, or standing up a test environment.

1. Start the gateway (first-party) on `127.0.0.1:7878` — it is NOT in compose.
2. `cd deploy && make config` — validate the compose.
3. Bring up what the deployment licensed:
   - everything: `make full`
   - or per capability: `make data secrets observability policy identity guardrails` …
4. `make smoke` — every service should return its health code.
5. Heavy services need a first-run step the first time:
   - **Superset:** `docker compose exec superset superset init`
   - **Langfuse / Marquez / Temporal:** allow ~60s for DB migrations on first boot.
6. Copy `deploy/.env.example` → `../.env.local`, set the adapter URLs + `OFFGRID_ADAPTER_<CAP>`.
7. `npx drizzle-kit push && npx tsx src/db/seed.ts` (first run), then start the console.
8. **Verify:** `cd deploy && make verify` (expect 11/11), or open **Admin → Integrations · adapters**.

### Teardown → restart (deterministic)

`make down` stops everything but **keeps the named volumes**, so Postgres audit data, ClickHouse,
MinIO and OpenSearch all persist. Two services rebuild their own runtime state on boot, so no
manual setup step is needed:

- **Keycloak** re-imports `deploy/keycloak/offgrid-realm.json` (`--import-realm`) → realm, client
  (fixed dev secret) and test user are back automatically.
- **Langfuse v3** re-runs its headless init → project + fixed key pair are back automatically.

So the full deterministic cycle is just:

```bash
cd deploy && make down            # stop; volumes (and audit history) survive
cd deploy && make up && make verify   # back up, realm + Langfuse keys auto-restore, 11/11
```

The gateway (`:7878`) is a separate first-party process — start it independently; `make down`
does not touch it.

---

## RB-2 · Enroll a desktop node

**Trigger:** a new device joins the fleet.

1. Console: **Control / Fleet → issue enrollment token** (`POST /api/v1/admin/enroll-token`).
2. Desktop app: **Settings → Fleet Console** → paste the console URL + token → **Connect**.
3. **Verify:** the device appears in **Fleet** (`GET /api/v1/devices`), `status: online`, and its
   model calls start landing in the **Control → Audit log** within ~60s.
4. Rollback: **Settings → Fleet Console → Disconnect** (clears the node's enrollment locally).

---

## RB-3 · Kill / isolate a compromised node

**Trigger:** suspected compromise, lost device, or off-boarding.

1. Console: **Fleet → the device → Kill** (`POST /api/v1/admin/devices/{id}/kill`).
2. The node consumes the command on its next poll (≤ poll interval, default 60s) and sets `killed`.
3. For immediate cut-off, also **revoke its virtual key** (RB-4) and block its egress at the network.
4. **Verify:** the device shows the kill state; no new audit events arrive from it.

---

## RB-4 · Issue / rotate / revoke a virtual key

**Trigger:** onboarding a user/project, suspected key leak, or rotation policy.

- **Issue:** **FinOps → Issue key** → scope to user/project + budget → **copy the token once**
  (`ogk_…`, never shown again).
- **Revoke:** **FinOps →** toggle the key **off** (`PATCH /api/v1/admin/keys/{id} {enabled:false}`)
  or delete it. Calls billed to it stop being accepted.
- **Rotate:** issue a new key, update the caller, then revoke the old one.
- **Verify:** **FinOps** spend-by-key shows the key inactive; the budget bar stops advancing.

---

## RB-5 · Budget overrun

**Trigger:** a key/project approaches or exceeds its budget (FinOps budget bar near 100%).

1. **FinOps →** identify the key (spend %, by-model breakdown shows the expensive model).
2. Short term: lower or revoke the key (RB-4), or add a **routing rule** sending that traffic to a
   cheaper/local model (RB-7).
3. Structural: raise the budget, or set egress policy to block cloud for that class.
4. **Verify:** spend rate drops on the next FinOps refresh.

---

## RB-6 · Tighten egress / data-residency

**Trigger:** policy change — sensitive data must stay on-device / in-country.

1. **Control → Policy:** set `egressAllowed = false` (master leash) → bumps policy version.
2. **Control → Model routing:** add rules — `data_class eq pii → local`, `region eq in → local`
   (RB/HOWTO). First match wins by priority.
3. Nodes converge on the new policy version on their next pull.
4. **Verify:** **Control → Model routing** tester: `region=in` → `local`; audit `leftDevice` stays
   false for that class.

---

## RB-7 · Swap a capability to its OSS backend

**Trigger:** scaling past the first-party default (e.g. real PII engine, KMS, SSO).

1. Bring up the service: `make secrets` (OpenBao) / `make guardrails` (Presidio) / `make identity`
   (Keycloak) / `make policy` (OPA) / `make lineage` (Marquez) …
2. Set the env: `OFFGRID_ADAPTER_<CAP>=<id>` + the service URL (see `deploy/.env.example`). The
   exact env block per tool is in `INTEGRATIONS.md` → "Configure each integration (cookbook)".
3. Restart the console (adapters read URLs at process start).
4. **Verify reachability:** `make smoke` + **Admin → Integrations · adapters** shows the new active
   adapter + `healthy`.
5. **Verify behavior** (in-path adapters — guardrails/policy/lineage): `make verify` sends the real
   request and asserts the response. Or confirm in-product: a PII check now reads
   `PII (presidio): …`; `/admin/abac/evaluate` returns `engine: opa`; the Marquez UI shows the
   `brain.ingest`/`brain.retrieve` jobs.
6. Rollback: unset the env var → reverts to the first-party default (no data loss). In-path OSS
   adapters also auto-fall-back to the default if the service goes unreachable.

---

## RB-8 · Security incident (CERT-In 6-hour clock)

**Trigger:** a reportable incident (Annexure-I), incl. AI/ML-system compromise.

1. **Contain:** kill affected nodes (RB-3), revoke keys (RB-4), set `egressAllowed=false` (RB-6).
2. **Evidence:** **Reports → CERT-In response pack** → download; pull the **audit log** and **Jaeger
   traces** for the window; **SIEM (OpenSearch)** for full-text search.
3. **Report:** file with CERT-In within **6 hours of awareness** (the pack lists the steps + the
   24×7 PoC requirement).
4. **Verify:** incident logged in the governance registry (kind `drill`/incident), timeline
   reconstructable from audit + traces.

---

## RB-9 · Respond to a regulator (IRDAI / RBI / SEBI / DPDP)

**Trigger:** a regulator asks about the AI system.

1. **Reports →** pick the regulator pack → **Generate** (downloads a Markdown pack: status caveats,
   the questions they'll ask + where the evidence is, framework coverage, live controls, governance
   items, data residency, model/data inventory, fleet).
2. Cross-check the **Governance registry** (Regulatory) — every policy/committee/process they expect
   is a tracked record with an owner + last-reviewed date.
3. Attach the **compliance evidence pack** (`/api/v1/admin/compliance/export`) for the framework.
4. **Verify:** the pack's "Evidence to have ready" list maps 1:1 to artifacts you hold.

---

## RB-10 · Backup & restore

**Trigger:** scheduled backup / DR.

- **Postgres** (state + append-only audit — the source of truth): `pg_dump` the `offgrid_console`
  DB on a schedule; treat the `audit_events` table as WORM (never edit/delete).
- **LanceDB** (Brain vectors): back up the `LANCEDB_PATH` directory (or re-embed from source docs).
- **OpenBao**: follow OpenBao's snapshot procedure for the KV store.
- **Restore:** restore Postgres, restore/`re-embed` the Brain, re-point env, `make up`, restart.
- **Verify:** posture %, audit count, and Brain `evals/run` recall all match pre-backup.

---

## RB-11 · Rotate secrets

**Trigger:** secret rotation policy / suspected exposure.

1. With `OFFGRID_ADAPTER_SECRETS=openbao`, write the new secret to OpenBao
   (`secret/data/<key>` KV v2); the adapter reads `.value`.
2. Rotate `OFFGRID_OPENBAO_TOKEN` and any provider keys; restart the console.
3. **Verify:** `GET /api/v1/admin/adapters?health=1` shows secrets `healthy`; dependent calls work.

---

## RB-12 · Upgrade / re-seed

1. Pull new images: `docker compose --profile all pull`, then `make up`.
2. Schema changes: `npx drizzle-kit push` (additive). Seeds are idempotent (skip if data present).
3. **Verify:** typecheck/lint clean in CI; `make smoke` green; `/docs` + `/handbook` 200.

## RB-13 · Turn on Agent QA (offline + online + drift)

1. `cd deploy && make qa` — brings up Evidently (`:8001`) + Ragas (`:8002`) sidecars.
2. Offline: `OFFGRID_ADAPTER_EVALS=ragas` (or leave `golden`); run `POST /admin/evals/run`.
3. Online: set `OFFGRID_LANGFUSE_URL` + `OFFGRID_LANGFUSE_AUTH`; ensure the `online-evals` flag is
   ON (Admin → Flags). Per-run scores then post to Langfuse automatically; tune
   `OFFGRID_QA_SAMPLE_RATE` (1 = every run).
4. Drift: `OFFGRID_ADAPTER_DRIFT=evidently` (needs ≥4 eval runs for a verdict).
5. Schedule the sweep: cron `*/30 * * * * curl -fsX POST $BASE/api/v1/admin/qa/sweep -H "authorization: Bearer $TOKEN" || alert`. 503 = degraded.
6. **Verify:** `make test-integrations` (QA + sweep checks green).

## RB-14 · Verify an exported report's provenance

1. Export with the manifest: `GET /admin/reports/<id>/export?format=pdf&manifest=1` → `manifest.json`.
2. Verify: `POST /admin/provenance/verify` with `{ "manifest": <manifest.json> }` →
   `signatureValid:true`. For ed25519, a third party verifies offline with the public key in the
   manifest — no shared secret. Hash mismatch ⇒ the file was altered after signing.

## RB-15 · Enable the sandbox for agent code execution

1. `OFFGRID_ADAPTER_SANDBOX=docker` (Docker available on the host); pre-pull `python:3.11-slim`,
   `node:20-slim`.
2. Turn ON the `agent-code-exec` flag (Admin → Flags) — OFF by default; the no-exec default refuses.
3. Test: `POST /admin/sandbox/run {"language":"python","code":"print(1)"}` → exit 0. Containers run
   `--network none`, memory/CPU/PID-capped, read-only, non-root, with a hard timeout.
4. For a sandbox tool an agent can call: create a tool with `type:sandbox`, script in `endpoint`;
   when routed to (flag on), the run executes it and records a `sandbox` step.

## RB-16 · Onboard FleetDM (Fleet Control)

1. `cd deploy && make mdm` — Fleet (`:8070`) + MySQL + Redis; first boot runs DB migrations.
2. Create an admin + API token:
   ```bash
   docker compose exec fleet fleetctl setup --email a@b.co --password '<pw>' --org-name OffGrid
   docker compose exec fleet sh -c 'fleetctl config set --address https://127.0.0.1:8070 --tls-skip-verify \
     && fleetctl login --email a@b.co --password "<pw>" && fleetctl get api-token'
   ```
3. Set `OFFGRID_ADAPTER_MDM=fleetdm`, `OFFGRID_FLEET_URL`, `OFFGRID_FLEET_TOKEN`; restart the console.
4. Enroll desktops: `fleetctl package --type=msi|pkg|deb --fleet-url … --enroll-secret …` → install
   fleetd. (Mobile stays an Off Grid node — osquery doesn't run on iOS/Android.)
5. **Verify:** `GET /admin/mdm/devices` shows `backend:"fleetdm"` + hosts; FleetDM `/healthz` 200.
