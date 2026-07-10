# Adversarial QA — Console DATA (connectors / warehouse / ETL / catalog / retention / RTBF / lineage)

Branch: `adv-data-qa` (off wave2 HEAD `2599cd8`). RED tests: `test/adversarial-data.test.ts`
(all `test.skip`, marked ADVERSARIAL, un-skip when the gap is fixed). No push / merge / deploy.
SAFETY: live probes are READ-ONLY (demo viewer / GETs). Every destructive / mutation vector below
was proven at the pure/model layer or is reserved for a LOCAL temp DB — NEVER run against the live
seeded demo (an RTBF/connector/warehouse write could corrupt it).

## Axes explored

- **connector type** — postgres / mysql / mssql / rest × **config validity** — valid / malformed /
  empty / hostile (metadata IP, loopback, RFC-1918) × **adapter reachable vs down**.
- **ETL job** — author / run / schedule × cron validity × DAG shape (cyclic / dangling) × cross-org
  connector reference × transform (derive expression) injection.
- **warehouse query** — operator SQL (read guard) × table-detail by name × org scoping × injection
  shape (table functions, qualified cross-org names).
- **catalog** — classification override / cross-org assetId × retention (delete/anonymize/archive) ×
  RTBF (console plane + cross-plane, org scoping).
- **lineage** — read/write when backend up vs down (#222) × org (namespace) scoping.
- **org-scoping** — org A acting on org B's data (read + destructive). **role** — viewer / writer /
  admin (all data routes are `requireAdmin`; the viewer-cred-leak is tracked as G-SEC-VIEWER-1).

## Journeys walked

1. Create a REST/SQL connector pointed at a hostile endpoint → Test Connection / Sync / list
   resources → server-side fetch/connect. (SSRF)
2. PATCH an existing connector's `type`/`endpoint` to bypass create validation. (SSRF re-entry + break)
3. Warehouse → SQL Console → run a "read" query using a ClickHouse table function. (SSRF / file read)
4. Warehouse → open a table by fully-qualified `other_org_db.table` name. (cross-org read)
5. Data → ETL → author a scheduled job with an impossible cron / a foreign-org connector in the DAG.
6. Governance → RTBF → issue a subject erasure and observe the console-plane DELETE scope.
7. Governance → retention → set a `delete` policy past its window and look for the disposal action.
8. Lineage → view the graph with Marquez down. (graceful, #222)

## Ledger

| ID | Sev | Break | Entry point | Proof |
|----|-----|-------|-------------|-------|
| G-ADV-DATA-4 | HIGH | RTBF console-plane DELETE not org-scoped → cross-tenant erasure | `erasure-requests/route.ts:26` | RED unit + local-DB repro |
| G-ADV-DATA-1 | HIGH | Warehouse read guard bypassed by ClickHouse table fns (SSRF/file/exfil) | `warehouse/query/route.ts` → `warehouse-model.ts:138` | RED unit (guard ok:true) |
| G-ADV-DATA-2 | HIGH | Connector endpoint no SSRF guard; PATCH does no validation | `connector-policy.ts:151` + `connectors/[id]/route.ts:31` | RED unit (create accepts hostile) |
| G-ADV-DATA-5 | HIGH | Warehouse reads not tenant-scoped (cross-org SELECT / table read) | `warehouse/query/route.ts:28` + `warehouse/[table]/route.ts` | RED unit + local-DB repro |
| G-ADV-DATA-3 | MED | ETL cron validator range-blind (job saves but never fires) | `etl-job.ts:75` | RED unit |
| G-ADV-DATA-6 | MED | Retention `delete` never executes (no disposal consumer) | `data-retention.ts:77` | code trace (no `src/app` consumer) |
| G-ADV-DATA-7 | MED | ETL DAG can reference a foreign-org connector, deployed via Kestra | `etl-job.ts:537` + `etl-jobs-store.ts:396` | code trace |
| G-ADV-DATA-8 | LOW | `setClassification` no asset-org ownership check | `data-catalog-store.ts:248` | code trace |
| G-ADV-DATA-9 | LOW | Lineage single global namespace (all orgs co-mingled) | `lineage.ts:10` | code trace |

Robust-verified ✓ (attacked, held): Kestra/Airbyte adapters (env-sourced URL, graceful-degrade),
lineage READ paths (#222 graceful), cyclic-DAG rejection, derive-expression injection guard, ETL job
CRUD/run org-scoping, SQL identifier interpolation guard.

## Repro + root cause (highlights)

### G-ADV-DATA-4 — RTBF cross-tenant DELETE (HIGHEST)
Root cause: `PlanStep` (`erasure.ts:61`) carries `{store,table,column,match,value}` and no org; the
tables in `ERASURE_CATALOG` (erasure.ts:40) are shared physical tables; the executor
(`erasure-requests/route.ts:26`) emits `DELETE FROM <table> WHERE <column> = <subject>` with no
`org_id`. The plan is identical regardless of caller → no org scope can enter the statement.
Local repro (temp DB, NOT the demo): insert rows for the same subject email under two org_ids in
`chat_messages`; run the POST as org A; assert org B's rows deleted. Pure proof: G-ADV-DATA-4 asserts
the plan step should carry an orgId (it does not).
Fix: add `orgId` to `planErasure`/`PlanStep`; append `AND org_id = $org` to the DELETE.

### G-ADV-DATA-1 — ClickHouse table-function SSRF
Root cause: the read-only guard is a leader + forbidden-token scan; ClickHouse table functions
(`url`,`file`,`s3`,`mysql`,`postgresql`,`remoteSecure`,…) are legal from a SELECT and absent from
`FORBIDDEN_TOKENS`. Repro (proven at the pure layer — do NOT point the live warehouse at an internal
host): `guardReadOnlySql("SELECT * FROM url('http://169.254.169.254/…',CSV,'x String')")` → ok:true.
Fix: table-function denylist in the guard, or a locked-down ClickHouse role.

### G-ADV-DATA-2 — connector SSRF (create + PATCH)
Root cause: no private-address/allowlist rule anywhere; `validateRest` accepts any http(s), the SQL
`HOST_RE` accepts loopback/IP hosts, and PATCH runs no validation at all. The exec layer fetches the
stored endpoint. Repro (pure): `validateConnectorCreate({type:'rest',baseUrl:'http://169.254.169.254/'})`
→ ok:true. Live delivery would be the `test` route, but that is a server-side fetch and was NOT fired
at an internal target during this pass. Fix: one shared `isSafeConnectorEndpoint()` reused by create
+ PATCH + exec (with DNS-rebind protection at fetch time); make PATCH run full create validation.

### G-ADV-DATA-5 — warehouse cross-org read
Root cause: no org→database mapping; `query()` and `[table]` are org-blind and `isSafeIdentifier`
permits a `db.table` qualifier. Local repro (two org DBs on a local ClickHouse): as org A run
`SELECT * FROM orgB_db.accounts` via /query, or GET `/warehouse/orgB_db.accounts` — both return org
B's rows. Fix: scope reads to the caller's org database / a read-only role.
