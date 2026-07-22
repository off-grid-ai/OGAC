# Resume prompt — 2026-07-23

Use this as the next agent's execution prompt.

## North star

The product direction is <https://off-grid-ai.github.io/ogac-landing-page-copy/>:
enable every person to operate with the intelligence and capabilities of the entire enterprise.
Prioritize reusable capabilities that strengthen **Sense → Understand → Act → Govern** for people,
Apps, and agents. Do not optimize for infrastructure activity or additional Next.js screens.

The eight-node fleet is only a cost-controlled demo fixture. Verify the complete product journey and
only the dependency it needs. Do not redeploy or re-certify unrelated services. Keep clients/APIs
thin; put OSS products behind provider-neutral Off Grid ports so they remain replaceable.

Read `AGENTS.md`, `docs/SERVICE_EXPANSION_AGENT_BRIEF.md`, the hygiene skill, and the tests skill.
Use at most three disjoint workers, monitor their actual diffs, make small commits, and push promptly.
Do not start new capability work until the active releases below are operational and recorded.

## Immediate priority: finish Onyx, nothing else

Onyx CE v4.4.1 is currently applying on g4 from private fleet SHA
`f0ab2495237a8b6de19530ef393b5fbd0f7d2d70`.

Last observed live state:

- apply wrapper PID `28854` is still active;
- seven Onyx containers have started;
- API, PostgreSQL, isolated OpenSearch, Redis, inference and indexing model servers are healthy;
- background worker was still `health: starting`;
- two mode-600 ephemeral env files remain under `/Users/admin/offgrid/runtime/onyx-g4` only while
  the wrapper runs; its trap must remove them on exit;
- durable secrets and the eventual Console receipt belong on S1/OpenBao only;
- Onyx is **not yet bootstrap-complete or live-verified**.

Do exactly this:

1. Through S1 (`admin@offgrid-tunnel`), inspect PID `28854` and g4 Docker using the absolute/admin
   OrbStack PATH. Do not start a duplicate apply.
2. Wait for apply to exit. Confirm all seven containers are healthy, g4 loopback
   `http://127.0.0.1:8080/health` passes, and both ephemeral env files were removed.
3. If apply failed, use the existing `deploy/onprem/deploy-onyx-g4.sh rollback` with the S1-piped
   env; preserve named volumes. Do not improvise a fleet recovery.
4. If apply passed, run the committed `bootstrap` once with the same manifest-verified release SHA
   and S1-piped env. Redirect its receipt directly to a root-owned mode-600 S1 file, persist the
   token/policy in OpenBao, and never print secret values.
5. Run committed `verify`. Required product evidence: private `ogac:<tenant>:<slug>` document set,
   real ingestion, scoped search, citation/provenance, retained state, and S1 loopback access.
6. Install the generated Onyx receipt in the S1 Console environment and deploy/restart only the
   Console artifact when ready. Then prove a real authenticated Console ingest → scoped search →
   citation journey. Until this passes, report Onyx as available on g4 but not product-live.
7. Update the private fleet records (`FLEET_INVENTORY.md`, `SERVICE_MAP.md`,
   `DEPLOYMENT_TOPOLOGY.md`, `SERVER_STATE.md`, recovery records) and the public service capability
   status/map with exact live evidence. Correct stale OpenBeam references to Onyx. Commit and push.

Onyx rollback receipts:

- service rollback: S1-piped env → `deploy/onprem/deploy-onyx-g4.sh rollback` (volumes preserved);
- topology rollback: `ONYX_CUTOVER_ID=onyx-20260722T231501Z deploy/onprem/cutover-onyx-g4.sh rollback`.

Important history: g4 OrbStack is configured at 13100 MiB, yielding Docker >=12.5 GiB while leaving
>=3 GiB for macOS. g4 Qwythos was retired to free the node. Do not spend time re-certifying the demo
topology. A cutover/rollback race left a possible stale g4 endpoint in g7's persisted plist; log it
as a fixture gap unless it actually prevents the product journey.

## Completed and pushed

### Organizational brain Console contract

Console commits through `b73aa779` implement the provider-neutral organizational-brain port and
Onyx adapter/routes. Independent witness: 31/31 focused tests and strict TypeScript passed. Existing
private document sets remain private; missing sets are created private; foreign sets are not
hydrated; authorization fails before provider I/O. It is code-wired, not yet Console-live.

### Great Expectations

GX Core 1.19 is live on g6 at exact image
`sha256:838009e3fad47b419ab0f542d166d97c7617390d96845b1648664a994bbd030b`.
Only GX was recreated. It is privately bound at `192.168.1.66:8003`, has persistent `gxdata`, and
is reachable through S1 `127.0.0.1:8944`. Live proof passed auth denial, tenant isolation, suite CRUD,
real ValidationDefinition pass/fail, history, idempotency, and persistence across GX-only restart.
Rollback image/receipt are retained on g6. The S1 Console env has the matching token, but Console was
not restarted, so Console-route consumption and UI are not claimed. Public/private records still
describe the old stateless GX and need correction after the next Console release.

Key GX commits: `54599d5b`, `691aa0fb`, `1aada023`, `c0805334`, `3c486ddc`, `19bb112a`,
`4cd42aa7`, `844fc8b4`, `ac27fc8a`.

### Kafka/S3 connector credentials

Private commits `ee01170` and `ca20ab3` are pushed. Canonical Bharat refs are org-scoped and the
checked migration is value-silent, CAS-safe, replayable, and independently passed 5/5 scripts.
The migration has not been run live. Run it immediately before deploying the Console release that
requires org-scoped refs; verify both connectors, then remove old keys as the script specifies.

### Presidio image redaction

Console is clean and pushed at `de70efaa`. Commits `61ee979c`, `6c579dcb`, `95fd58c3`, `d2808676`,
and `de70efaa` add a provider-neutral contract, authenticated API, actual
`presidio-image-redactor==0.0.59`/Tesseract sidecar, cancellation-safe bounded execution, and private
Compose service. Local real-engine proof detected/redacted EMAIL_ADDRESS. Image digest:
`sha256:6bc076a2c34d3d3114393dc4d6205cad9b8c43e9104cea0cdb078bea818d395c`.
It is code-wired/local-proven only: no fleet deployment, UI, or live workflow evidence. Do not start
that deployment until Onyx is operational and records are current.

## Next backlog after release closure

Do not re-audit priorities. After Onyx/GX/Kafka records and Console release are closed, the next
product wave should expose the organizational brain as a shared consumer capability for people,
Apps, and agents, then deploy/prove Presidio image redaction. AI QA remains a distinct future product
category for externally built AI applications; it is recorded in `docs/GAPS_BACKLOG.md`.

