// ─── Demo seed: real code-EXEC runs for /build/sandbox (aka /solutions/test) ──────────────────────
//
// WHY. src/lib/sandbox-runs-store.ts just landed a persisted history for the docker-backed code
// sandbox, but nothing had ever exercised it: live check (2026-08-11) showed `sandbox_runs` held a
// single row for org_suraksha (from this task's own connectivity probe) and NONE for org_bharat, so
// the "Recent runs" table and its 5 stat tiles (ok/failed/timeout/refused/total) still read as an
// unused feature. `agent-code-exec` is confirmed ON (global flag) and the active adapter is the real
// docker sandbox (network-disabled, resource-capped container per run) — genuinely exec-capable, not
// a stub.
//
// WHAT. A handful of small, tenant-domain-appropriate snippets (insurer: persistency/claim-ratio/PAN
// checks · bank: EMI/NPA/IFSC checks), run through the REAL run endpoint so the docker container
// actually executes them. One snippet per tenant is a deliberately malformed-data parse (a KeyError /
// TypeError) so the history shows a genuine "failed" run alongside the "ok" ones — a sandbox that
// only ever shows green runs looks staged; a real one occasionally hits bad input.
//
// HOW. POSTs to /api/v1/admin/sandbox/run on each tenant's own public host with the console's admin
// bearer (the same "Authorization: Bearer <OFFGRID_ADMIN_TOKEN>" service-account path documented in
// console/CLAUDE.md) — the EXACT route the "Run Code" panel calls. currentOrgId() binds the org from
// the Host header (an admin/service principal on a tenant subdomain binds to that tenant), so each
// run is recorded under the right org with no direct DB write. Never touches sandbox_runs directly.
//
// IDEMPOTENT: reads the current run count per tenant first (GET /api/v1/admin/sandbox) and only
// tops up to TARGET_RUNS — a re-run against an already-seeded tenant does nothing.
//
// RUN (from anywhere with network access to the live hosts):
//   OFFGRID_ADMIN_TOKEN=<token> npx tsx scripts/seed-sandbox-runs.mts
const ADMIN_TOKEN = process.env.OFFGRID_ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error('[seed:sandbox-runs] OFFGRID_ADMIN_TOKEN is required (the console admin bearer).');
  process.exit(1);
}

const TARGET_RUNS = 6;

interface Snippet {
  language: 'python' | 'node';
  code: string;
}

interface TenantSeed {
  host: string;
  label: string;
  snippets: readonly Snippet[];
}

const SURAKSHA: TenantSeed = {
  host: process.env.SURAKSHA_HOST ?? 'https://suraksha-onprem-console.getoffgridai.co',
  label: 'org_suraksha',
  snippets: [
    {
      language: 'python',
      code:
        'premiums = [12000, 15000, 9000, 21000, 18000]\n' +
        'paid = [1, 1, 0, 1, 1]\n' +
        'paid_amt = sum(p for p, x in zip(premiums, paid) if x)\n' +
        'total = sum(premiums)\n' +
        'print(f"persistency: {round(100 * paid_amt / total, 2)}%")\n',
    },
    {
      language: 'node',
      code:
        'const pans = ["ABCDE1234F", "INVALIDPAN", "PQRST5678K"];\n' +
        'const re = /^[A-Z]{5}[0-9]{4}[A-Z]$/;\n' +
        'pans.forEach((p) => console.log(p, re.test(p) ? "valid" : "invalid"));\n',
    },
    {
      language: 'python',
      code: 'claims_filed = 118\nclaims_settled = 101\nprint(f"settlement ratio: {round(100 * claims_settled / claims_filed, 2)}%")\n',
    },
    {
      language: 'node',
      code:
        'const lastPaid = new Date("2026-05-14");\n' +
        'const next = new Date(lastPaid);\n' +
        'next.setMonth(next.getMonth() + 3);\n' +
        'console.log("next premium due:", next.toISOString().slice(0, 10));\n',
    },
    {
      // Deliberately malformed input — a real analyst validation catching a bad claims batch.
      language: 'python',
      code: 'rows = [{"claim_id": 1, "amount": "12000"}, {"claim_id": 2}]\ntotal = sum(int(r["amount"]) for r in rows)\nprint(total)\n',
    },
  ],
};

const BHARAT: TenantSeed = {
  host: process.env.BHARAT_HOST ?? 'https://bharatunion-onprem-console.getoffgridai.co',
  label: 'org_bharat',
  snippets: [
    {
      language: 'python',
      code: 'P = 500000\nr = 0.095 / 12\nn = 60\nemi = P * r * (1 + r) ** n / ((1 + r) ** n - 1)\nprint(f"EMI: INR {round(emi, 2)}")\n',
    },
    {
      language: 'node',
      code:
        'const codes = ["HDFC0001234", "BADCODE", "SBIN0002345"];\n' +
        'const re = /^[A-Z]{4}0[A-Z0-9]{6}$/;\n' +
        'codes.forEach((c) => console.log(c, re.test(c) ? "valid" : "invalid"));\n',
    },
    {
      language: 'python',
      code:
        'loans = [{"id": 1, "dpd": 45}, {"id": 2, "dpd": 95}, {"id": 3, "dpd": 10}]\n' +
        'for l in loans:\n' +
        '    status = "NPA" if l["dpd"] > 90 else ("SMA-2" if l["dpd"] > 60 else "standard")\n' +
        '    print(l["id"], status)\n',
    },
    {
      language: 'node',
      code: 'const P = 200000, r = 0.07, t = 2;\nconst maturity = P * Math.pow(1 + r / 4, 4 * t);\nconsole.log("FD maturity:", maturity.toFixed(2));\n',
    },
    {
      // Deliberately malformed input — a null amount blows up the batch total.
      language: 'python',
      code: 'txns = [{"amount": "5000"}, {"amount": None}]\ntotal = sum(int(t["amount"]) for t in txns)\nprint(total)\n',
    },
  ],
};

async function currentRunCount(host: string): Promise<number> {
  const res = await fetch(`${host}/api/v1/admin/sandbox`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET /api/v1/admin/sandbox → HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { runs?: unknown[] } };
  return body.data?.runs?.length ?? 0;
}

async function runOne(host: string, snippet: Snippet): Promise<{ ok: boolean; refused: string }> {
  const res = await fetch(`${host}/api/v1/admin/sandbox/run`, {
    method: 'POST',
    headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language: snippet.language, code: snippet.code }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; refused?: string; error?: string };
  if (res.status >= 500) throw new Error(`POST run → HTTP ${res.status}: ${body.error ?? ''}`);
  return { ok: body.ok === true, refused: body.refused ?? '' };
}

async function seedTenant(seed: TenantSeed): Promise<void> {
  const existing = await currentRunCount(seed.host);
  if (existing >= TARGET_RUNS) {
    console.log(`[seed:sandbox-runs] ${seed.label}: already has ${existing} runs (>= ${TARGET_RUNS}) — skipping`);
    return;
  }
  const need = TARGET_RUNS - existing;
  const toRun = seed.snippets.slice(0, need);
  console.log(`[seed:sandbox-runs] ${seed.label}: has ${existing} runs, adding ${toRun.length}`);
  for (const snippet of toRun) {
    const result = await runOne(seed.host, snippet);
    console.log(
      `  ${seed.label} ${snippet.language}: ${result.refused ? `refused (${result.refused})` : result.ok ? 'ok' : 'failed'}`,
    );
  }
}

async function main(): Promise<void> {
  await seedTenant(SURAKSHA);
  await seedTenant(BHARAT);
  console.log('[seed:sandbox-runs] done.');
}

main().catch((e) => {
  console.error('[seed:sandbox-runs] FATAL', e);
  process.exit(1);
});
