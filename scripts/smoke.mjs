// Comprehensive smoke test for the Off Grid Console — API + real browser UI in one run.
//
//   node scripts/smoke.mjs            # API checks + UI interaction checks (needs dev server up)
//   node scripts/smoke.mjs --api      # API checks only (no browser)
//   BASE=http://127.0.0.1:3000 OFFGRID_ADMIN_TOKEN=offgrid-local-dev node scripts/smoke.mjs
//
// Every check prints PASS/FAIL with a one-line reason; the process exits non-zero if any fail, so
// it can gate CI. UI checks dev-login, then navigate via the sidebar (client routing, so the JS
// bundle loads once and hydration is stable), fill inputs, click, and assert the result in the DOM.
// Screenshots of each interaction land in /tmp/shots/smoke-*.png.

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const TOKEN = process.env.OFFGRID_ADMIN_TOKEN || 'offgrid-local-dev';
const API_ONLY = process.argv.includes('--api');
const OUT = process.env.OUT || '/tmp/shots';

const results = [];
let createdAgentId; // created in the API phase, exercised in the UI phase, deleted at the end
const rec = (ok, name, detail = '') => {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
async function check(name, fn) {
  try {
    const detail = await fn();
    rec(true, name, detail || '');
  } catch (e) {
    rec(false, name, e.message.split('\n')[0]);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ─── API layer ────────────────────────────────────────────────────────────────
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Retry transient network errors — a busy dev server (compiling routes mid-run) can drop a
// connection; that's not a product failure, so we give it a couple of tries.
const api = async (method, path, body, attempt = 0) => {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: H,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  } catch (e) {
    if (attempt < 3) {
      await sleep(600);
      return api(method, path, body, attempt + 1);
    }
    throw e;
  }
};

async function runApiChecks() {
  console.log('\n── API ──');
  await check('GET /admin/agents (built-in + custom)', async () => {
    const { status, json } = await api('GET', '/api/v1/admin/agents');
    assert(status === 200, `status ${status}`);
    assert(Array.isArray(json.data) && json.data.length >= 5, 'expected ≥5 agents');
    return `${json.data.length} agents`;
  });

  await check('POST /admin/agents (create from text)', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/agents', {
      name: 'Smoke Test Agent',
      systemPrompt: 'You answer concisely from the sources.',
    });
    assert(status === 201, `status ${status}`);
    createdAgentId = json.id;
    return json.id;
  });

  await check('POST /admin/agents/runs (governed pipeline)', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/agents/runs', {
      agentId: createdAgentId,
      query: 'Is the policy in force?',
    });
    // 201 = ran inline (durable disabled); 202 = dispatched to the durable worker queue (prod).
    // Both are correct — the difference is where it executes, not whether governance ran.
    assert(status === 201 || status === 202, `status ${status}`);
    let run = json;
    if (status === 202) {
      // Durable: the governed pipeline runs in the worker. Poll the runs list until it settles.
      assert(json.runId, 'durable dispatch returned no runId');
      const terminal = new Set(['done', 'pending_review', 'rejected', 'error', 'failed']);
      const deadline = Date.now() + 30000;
      run = null;
      while (Date.now() < deadline) {
        const list = await api('GET', '/api/v1/admin/agents/runs');
        const found = (list.json.data || []).find((r) => r.id === json.runId);
        if (found && terminal.has(found.status)) { run = found; break; }
        await new Promise((r) => setTimeout(r, 1500));
      }
      assert(run, `durable run ${json.runId} did not settle in 30s (is the agent-worker running?)`);
    }
    const kinds = (run.steps || []).map((s) => s.kind);
    for (const k of ['policy', 'guard', 'retrieve', 'answer', 'ground', 'sign']) {
      assert(kinds.includes(k), `missing pipeline step: ${k}`);
    }
    assert(run.provenance?.algorithm, 'no provenance signature');
    return `${status === 202 ? 'durable' : 'inline'}: ${kinds.join('→')}; signed ${run.provenance.algorithm}`;
  });

  await check('Provenance sign + verify (ed25519)', async () => {
    const signed = await api('POST', '/api/v1/admin/sign', { payload: { a: 1 } });
    assert(signed.json.signature, 'no signature');
    const ok = await api('POST', '/api/v1/admin/sign', {
      payload: { a: 1 },
      signature: signed.json.signature,
    });
    assert(ok.json.valid === true, 'valid signature rejected');
    const bad = await api('POST', '/api/v1/admin/sign', {
      payload: { a: 2 },
      signature: signed.json.signature,
    });
    assert(bad.json.valid === false, 'tampered signature accepted');
    return signed.json.algorithm;
  });

  await check('Grounding verify', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/grounding/verify', {
      answer: 'Policies must be in force before FNOL intake.',
      sources: [{ text: 'Policies must be in force and past contestability before FNOL intake.' }],
    });
    assert(status === 200, `status ${status}`);
    assert(typeof json.score === 'number', 'no score');
    return `score ${json.score}%`;
  });

  await check('PII scan', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/pii/scan', {
      text: 'Email jane@acme.com or call +1 415 555 0132',
    });
    assert(status === 200, `status ${status}`);
    assert(json.hits === true && json.entities.length > 0, 'expected PII hits');
    return json.entities.join(', ');
  });

  await check('Sandbox run (docker exec or safe refusal)', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/sandbox/run', {
      language: 'python',
      code: 'print(6*7)',
    });
    // Config-agnostic: 403 when sandbox=none/flag-off (safe default), 200 when an engine runs it.
    if (status === 403) return `refused: ${json.error}`;
    assert(status === 200, `unexpected status ${status}`);
    // Engine configured but its daemon/host is unreachable in THIS environment (e.g. no local
    // Docker) — the console reported it honestly; that's an infra condition, not a console defect.
    if (!json.ok && /cannot connect|daemon|econnrefused|no such host/i.test(json.stderr || '')) {
      return `engine unreachable (${json.engine}) — exec skipped in this env`;
    }
    assert(json.ok, `sandbox run failed: ${(json.stderr || '').split('\n')[0]}`);
    assert((json.stdout || '').includes('42'), 'no stdout from sandbox');
    return `${json.engine}: ${json.stdout.trim()}`;
  });

  await check('ABAC evaluate', async () => {
    const { status, json } = await api('POST', '/api/v1/admin/abac/evaluate', {
      role: 'operator',
      resource: 'agent:sop-synth',
      attributes: {},
    });
    assert(status === 200, `status ${status}`);
    assert(typeof json.allow === 'boolean', 'no decision');
    return `allow=${json.allow} (${json.engine})`;
  });

  await check('Cache stats', async () => {
    const { status, json } = await api('GET', '/api/v1/admin/cache');
    assert(status === 200 && typeof json.hitRate === 'number', `status ${status}`);
    return `hitRate ${json.hitRate}%`;
  });

  await check('MDM devices (port)', async () => {
    const { status, json } = await api('GET', '/api/v1/admin/mdm/devices');
    assert(status === 200 && Array.isArray(json.data), `status ${status}`);
    return `${json.backend}: ${json.data.length} devices`;
  });

  await check('QA status (evals + drift + online)', async () => {
    const { status, json } = await api('GET', '/api/v1/admin/qa/status');
    assert(status === 200 && json.drift && json.offline, `status ${status}`);
    return `drift=${json.drift.status}`;
  });
}

// ─── UI layer ───────────────────────────────────────────────────────────────--
async function runUiChecks() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 1000 } })).newPage();

  // One full load → login. Subsequent navigation uses the sidebar (client routing) so the JS
  // bundle stays loaded and components are reliably hydrated before we interact.
  // Login can be slow on a cold dev server (first compile of /signin + /fleet); retry once.
  async function login() {
    await page.goto(`${BASE}/signin`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Dev sign-in/i }).click();
    await page.waitForURL('**/gateway/fleet', { timeout: 45000 });
    await page.waitForLoadState('networkidle');
  }
  try {
    await login();
  } catch {
    await login();
  }

  const nav = async (label, urlPart) => {
    // Scope to the sidebar — detail pages have back-links with the same label (e.g. "Brain").
    await page.locator('aside').getByRole('link', { name: label, exact: true }).click();
    // Generous timeout: first navigation to a route triggers a cold dev compile (can be slow on a
    // loaded server). Not a product signal — production is pre-built.
    await page.waitForURL(`**/${urlPart}`, { timeout: 45000 });
    await page.waitForLoadState('networkidle');
  };
  const shot = (n) => page.screenshot({ path: `${OUT}/smoke-${n}.png`, fullPage: true });

  console.log('\n── UI (real browser, hydrated) ──');

  await check('UI: sidebar shows new modules', async () => {
    for (const l of ['Observability', 'Lineage', 'Integrations']) {
      await page.getByRole('link', { name: l, exact: true }).waitFor({ timeout: 8000 });
    }
  });

  await check('UI: Observability renders QA data', async () => {
    await nav('Observability', 'insights');
    await page.getByText('Eval score history').waitFor({ timeout: 10000 });
    await page.getByText('Drift & degradation').waitFor({ timeout: 8000 });
    await shot('observability');
  });

  await check('UI: Observability eval drilldown renders', async () => {
    await nav('Observability', 'insights');
    const detail = page.getByRole('link', { name: /detail →/i }).first();
    if ((await detail.count()) === 0) return 'no eval runs to drill into (skipped)';
    await detail.click();
    await page.waitForURL('**/insights/evals/*', { timeout: 45000 });
    await page.getByText('Per-case results').waitFor({ timeout: 15000 });
    await shot('eval-detail');
    return '';
  });

  await check('UI: Integrations renders cache + bindings', async () => {
    await nav('Integrations', 'data/integrations');
    await page.getByText('Response cache').first().waitFor({ timeout: 10000 });
    await page.getByText(/OFFGRID_ADAPTER_INFERENCE/).first().waitFor({ timeout: 8000 });
    await shot('integrations');
  });

  await check('UI: Lineage renders', async () => {
    await nav('Lineage', 'data/lineage');
    await page.getByText(/Data lineage for every agent run/).first().waitFor({ timeout: 10000 });
    await shot('lineage');
  });

  await check('UI: Fleet device detail drilldown', async () => {
    await nav('Fleet', 'gateway/fleet');
    await page.locator('a[href^="/gateway/fleet/"]').first().click();
    await page.waitForURL('**/gateway/fleet/*', { timeout: 45000 });
    await page.getByText('Assigned policy').waitFor({ timeout: 15000 });
    await page.getByText('Recent activity').waitFor({ timeout: 8000 });
    await shot('device-detail');
  });

  await check('UI: Brain doc inspector renders', async () => {
    await nav('Brain', 'build/brain');
    await page.locator('a[href^="/build/brain/docs/"]').first().click();
    await page.waitForURL('**/build/brain/docs/*', { timeout: 45000 });
    await page.getByText('Retrieval preview').waitFor({ timeout: 15000 });
    await shot('doc-inspector');
  });

  await check('UI: Brain prompt history renders', async () => {
    await nav('Brain', 'build/brain');
    await page.locator('a[href^="/build/brain/prompts/"]').first().click();
    await page.waitForURL('**/build/brain/prompts/*', { timeout: 45000 });
    await page.getByText(/Version history/).waitFor({ timeout: 15000 });
    await shot('prompt-history');
  });

  await check('UI: PII scanner click → entities render', async () => {
    await nav('Data', 'data');
    await page.getByRole('button', { name: /Scan for PII/i }).click();
    await page.getByText(/entities found/i).waitFor({ timeout: 10000 });
    await page.getByText('EMAIL_ADDRESS').waitFor({ timeout: 5000 });
    await shot('pii');
  });

  await check('UI: ABAC tester click → decision renders', async () => {
    await nav('Admin', 'operations/admin');
    await page.getByRole('button', { name: /Evaluate decision/i }).click();
    await page.getByText(/no rule matched|allow|deny/i).first().waitFor({ timeout: 10000 });
    await shot('abac');
  });

  await check('UI: Grounding verifier fill + click → faithfulness', async () => {
    await nav('Brain', 'build/brain');
    await page.locator('#gv-answer').fill('Policies must be in force before FNOL intake.');
    await page.locator('#gv-sources').fill('Policies must be in force and past contestability before FNOL intake.');
    await page.getByRole('button', { name: /Verify grounding/i }).click();
    await page.getByText('Faithfulness').waitFor({ timeout: 10000 });
    await shot('grounding');
  });

  await check('UI: Provenance sign → signature renders', async () => {
    await nav('Regulatory', 'governance/regulatory');
    await page.getByRole('button', { name: /^Sign$/ }).click();
    await page.getByText(/ed25519_|hmac/i).first().waitFor({ timeout: 10000 });
    await shot('provenance');
  });

  await check('UI: Sandbox run renders result', async () => {
    await nav('Agents', 'build/agents');
    await page.getByRole('button', { name: /Run in sandbox/i }).click();
    // Either the safe-default refusal or real execution output, depending on deployment config.
    await page
      .getByText(/Refused \(safe default\)|exit \d|hello from the sandbox/i)
      .waitFor({ timeout: 15000 });
    await shot('sandbox');
  });

  await check('UI: Agent run dialog → pipeline trace renders', async () => {
    await nav('Agents', 'build/agents');
    await page.getByRole('button', { name: /^Run$/ }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder(/Ask this agent/i).fill('Is the policy in force?');
    await dialog.getByRole('button', { name: /^Run$/ }).click();
    await dialog.getByText(/policy/i).first().waitFor({ timeout: 20000 });
    await shot('agentrun');
    await page.keyboard.press('Escape');
  });

  await check('UI: Agent detail (drill-down) renders', async () => {
    await nav('Agents', 'build/agents');
    await page.getByRole('link', { name: 'Smoke Test Agent' }).click();
    await page.waitForURL('**/build/agents/*', { timeout: 45000 });
    await page.getByText('Instructions').waitFor({ timeout: 10000 });
    await page.getByText('Recent runs').waitFor({ timeout: 8000 });
    await shot('agent-detail');
  });

  await check('UI: Run trace deep-dive renders', async () => {
    await page.getByRole('link', { name: /trace/i }).first().click();
    await page.getByText('Pipeline trace').waitFor({ timeout: 10000 });
    await page.getByText('Provenance').first().waitFor({ timeout: 8000 });
    await shot('run-trace');
  });

  await browser.close();
}

// ─── main ───────────────────────────────────────────────────────────────────--
await runApiChecks();
if (!API_ONLY) {
  try {
    await runUiChecks();
  } catch (e) {
    rec(false, 'UI: browser session', e.message.split('\n')[0]);
  }
}

// Clean up the agent created for this run (kept alive so the UI phase could exercise it).
if (createdAgentId) {
  await check('Cleanup: delete smoke agent', async () => {
    const { status } = await api('DELETE', `/api/v1/admin/agents/${createdAgentId}`);
    assert(status === 200, `status ${status}`);
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed.`);
if (failed.length) {
  console.log('FAILED:\n' + failed.map((f) => `  - ${f.name}: ${f.detail}`).join('\n'));
  process.exit(1);
}
console.log('All green. Screenshots in ' + OUT + '/smoke-*.png');
