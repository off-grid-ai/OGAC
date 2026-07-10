import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardReadOnlySql } from '../src/lib/warehouse-model.ts';
import { validateConnectorCreate } from '../src/lib/connector-policy.ts';
import { isValidCron } from '../src/lib/etl-job.ts';
import { planErasure, type PlanStep } from '../src/lib/erasure.ts';

// ─────────────────────────────────────────────────────────────────────────────
// ADVERSARIAL — CONSOLE DATA (connectors / warehouse). Each `test.skip` asserts the
// DESIRED behaviour that the code CURRENTLY FAILS, so it stays RED until the gap is
// fixed. Un-skip after the fix lands. Findings logged in docs/GAPS_BACKLOG.md and
// docs/adversarial/data.md. Proven empirically against the real pure functions.
// ─────────────────────────────────────────────────────────────────────────────

// ── G-ADV-DATA-1 — ClickHouse table functions bypass the read-only guard (SSRF / local-file read / exfil)
// guardReadOnlySql() only checks: single statement, read leader (SELECT/…), no forbidden write/DDL
// token, no comments. It does NOT block ClickHouse's *table functions* — url(), file(), s3(),
// mysql(), postgresql(), remoteSecure() — which are all reachable from a leading SELECT. So an
// operator-typed "read" query can make the warehouse fetch an attacker URL (SSRF, incl. the cloud
// metadata endpoint), read local files off the ClickHouse box (/etc/passwd), or exfiltrate to an
// external host. Proven: guardReadOnlySql returns ok:true for every payload below.
test.skip('ADVERSARIAL G-ADV-DATA-1: read-only guard must reject ClickHouse url()/file()/s3()/mysql() table functions', () => {
  const ssrfAndFileReads = [
    `SELECT * FROM url('http://169.254.169.254/latest/meta-data/', CSV, 'x String')`,
    `SELECT * FROM file('/etc/passwd', 'LineAsString', 'l String')`,
    `SELECT * FROM s3('http://internal-minio:9000/bucket/secret.csv', 'CSV')`,
    `SELECT * FROM mysql('10.0.0.9:3306', 'corebank', 'accounts', 'root', '')`,
    `SELECT * FROM postgresql('10.0.0.9:5432', 'corebank', 'accounts', 'u', 'p')`,
  ];
  for (const sql of ssrfAndFileReads) {
    const r = guardReadOnlySql(sql);
    assert.equal(
      r.ok,
      false,
      `guard must reject SSRF/file-read table function but ALLOWED it: ${sql}`,
    );
  }
});

// ── G-ADV-DATA-2 — connector endpoint has NO SSRF/private-address guard
// validateConnectorCreate() (the single create gate) accepts ANY http(s) base URL for REST and any
// charset-valid host for SQL — including the cloud metadata IP, localhost, and RFC-1918 ranges. The
// exec layer (testConnection / recordCount / execConnectorQuery / listResources) then fetches/connects
// to that endpoint FROM THE SERVER with no allowlist. A low-privilege writer who can create a
// connector and hit "Test Connection" turns the console into an SSRF proxy — and for REST the
// response body is returned to them via recordCount/execConnectorQuery. Proven: all ACCEPTED today.
test.skip('ADVERSARIAL G-ADV-DATA-2: connector create must reject metadata/loopback/private-range endpoints', () => {
  const hostile = [
    { name: 'a', type: 'rest', baseUrl: 'http://169.254.169.254/latest/meta-data/' },
    { name: 'a', type: 'rest', baseUrl: 'http://localhost:6379/' },
    { name: 'a', type: 'rest', baseUrl: 'http://127.0.0.1:8941/' },
    { name: 'a', type: 'postgres', host: '169.254.169.254', database: 'd', user: 'u', password: 'p' },
    { name: 'a', type: 'postgres', host: 'localhost', database: 'd', user: 'u', password: 'p' },
    { name: 'a', type: 'postgres', host: '10.0.0.5', database: 'd', user: 'u', password: 'p' },
  ];
  for (const input of hostile) {
    const r = validateConnectorCreate(input);
    assert.equal(
      r.ok,
      false,
      `create must reject a private/metadata endpoint but ACCEPTED it: ${input.baseUrl ?? input.host}`,
    );
  }
});

// ── G-ADV-DATA-3 — ETL scheduled-job cron validator accepts out-of-range / impossible fields
// isValidCron() (the gate validateJobDraft/validateDagSpec run for a scheduled job) uses a regex
// whose numeric alternatives are just `\d+` with NO range bounds. So `99 99 99 99 99` and
// `88 * * * *` (minute 88) pass as "valid" and the job is persisted as scheduled — the operator
// gets a green save for a schedule that can NEVER fire (silent data-movement gap), or a confusing
// downstream rejection from Kestra/Airbyte. A cron validator must range-check each field
// (min 0-59, hour 0-23, dom 1-31, mon 1-12, dow 0-7). Proven: all VALID today.
test.skip('ADVERSARIAL G-ADV-DATA-3: cron validator must reject out-of-range fields', () => {
  const impossible = [
    '99 99 99 99 99', // every field out of range
    '88 * * * *', //     minute 88 (>59)
    '* 25 * * *', //      hour 25 (>23)
    '* * 40 * *', //      day-of-month 40 (>31)
    '* * * 13 *', //      month 13 (>12)
    '* * * * 9', //       day-of-week 9 (>7)
  ];
  for (const expr of impossible) {
    assert.equal(
      isValidCron(expr),
      false,
      `cron validator must reject an out-of-range expression but ACCEPTED it: "${expr}"`,
    );
  }
  // A genuinely valid cron must still pass (guards against an over-broad fix).
  assert.equal(isValidCron('*/5 0 1 * 1'), true, 'a real cron must remain valid');
});

// ── G-ADV-DATA-4 — RTBF console-plane DELETE is NOT org-scoped → destructive cross-tenant erasure
// The erasure PLAN carries {store, table, column, match, value} and NO org identifier. Every catalog
// table (chat_messages, audit_events, api_keys, …) is a SHARED physical table across tenants, keyed
// only by the subject value. The route executes `DELETE FROM <table> WHERE <column> = <subject>`
// (erasure-requests/route.ts:26) with no `org_id` predicate. So an RTBF issued by org A for a subject
// deletes that subject's rows in EVERY org's data in those shared tables. Root cause is provable
// purely: the plan is identical regardless of who calls it — there is nowhere for an org scope to
// enter the executed statement. A tenant-safe design must thread orgId into PlanStep and the WHERE.
test.skip('ADVERSARIAL G-ADV-DATA-4: RTBF plan step must carry an org scope so the DELETE is tenant-bounded', () => {
  const step = planErasure('foo@example.com').steps[0] as PlanStep & { orgId?: unknown };
  // The step feeds a raw `DELETE FROM table WHERE column = value` with no other predicate. For the
  // delete to be tenant-safe the step MUST carry an org scope the executor can add to the WHERE.
  assert.ok(
    'orgId' in step && step.orgId != null && step.orgId !== '',
    'RTBF PlanStep carries no orgId — the executed DELETE spans every tenant sharing the table',
  );
});

// ── G-ADV-DATA-5 — warehouse reads have no tenant isolation (cross-org ClickHouse read)
// Neither the operator-SQL path (query()) nor the table-detail path ([table]/route.ts) scopes to the
// caller's org: query() runs ANY guarded SELECT across all ClickHouse databases, and the [table]
// route reads any `db.table` by name (no currentOrgId import). System DBs are excluded from the
// LISTING only, not from reads. A cross-org read is therefore reachable via a fully-qualified name
// like `other_org_db.accounts`. isSafeIdentifier ALLOWS a `database.table` qualifier — which is
// exactly the vector: the guard that should stop cross-org access instead permits the qualifier.
// (Proven here at the pure layer; the integration repro against a local ClickHouse is in
// docs/adversarial/data.md — NOT run against the live seeded demo.)
test.skip('ADVERSARIAL G-ADV-DATA-5: a cross-org qualified SELECT must not pass the warehouse read guard unscoped', () => {
  // The guard passes this statement — nothing binds it to the caller's org/database.
  const crossOrg = 'SELECT * FROM bharatunion_db.accounts LIMIT 10';
  const g = guardReadOnlySql(crossOrg);
  // A tenant-isolated warehouse must NOT allow an operator to name another org's database. Today the
  // read-only guard is the ONLY gate and it is org-blind, so it returns ok:true. This asserts the
  // desired state: cross-org qualified reads are rejected (or scoped) before hitting ClickHouse.
  assert.equal(
    g.ok,
    false,
    'read guard allowed a cross-org qualified SELECT — warehouse reads are not tenant-scoped',
  );
});
