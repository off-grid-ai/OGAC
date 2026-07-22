// Live verification of the SOP / template-reuse flow against a real dev server + real Postgres.
// Signs in (dev), creates a multi-step app via the real admin API, publishes it as an org template
// with a {{team}} variable, then drives the browser through the template LIBRARY (list → detail →
// adopt), asserting the adopted app lands with the variable bound. Screenshots the library + detail.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';
import { chromium } from 'playwright';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited early.\n${logs.join('')}`);
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {
      /* still compiling */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Next did not become ready.\n${logs.join('')}`);
}

const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];
// A git worktree has no node_modules of its own — resolve next from wherever it's installed
// (env override, the worktree, or the shared checkout two levels up under .claude/worktrees).
const nextBin =
  process.env.NEXT_BIN ??
  ['node_modules/next/dist/bin/next', '../../../../node_modules/next/dist/bin/next'].find((p) =>
    existsSync(path.resolve(p)),
  ) ??
  'node_modules/next/dist/bin/next';
const server = spawn(
  process.execPath,
  [path.resolve(nextBin), 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AUTH_DEV_LOGIN: 'true',
      AUTH_SECRET: process.env.AUTH_SECRET ?? 'sop-template-reuse-verification-secret-32-bytes-long',
      OFFGRID_ORG: 'default',
      OFFGRID_ADMIN_TOKEN: process.env.OFFGRID_ADMIN_TOKEN ?? 'dev-admin-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  },
);
for (const s of [server.stdout, server.stderr]) {
  s.on('data', (c) => {
    logs.push(String(c));
    if (logs.length > 300) logs.shift();
  });
}

let browser;
try {
  await waitForServer(`${baseUrl}/signin`, server, logs);
  console.log('sop-verify: server ready');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1512, height: 1000 },
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
  });
  const page = await context.newPage();

  await page.goto(`${baseUrl}/signin?callbackUrl=%2Fsolutions%2Ftemplates`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.waitForURL('**/solutions/templates');
  console.log('sop-verify: authenticated, template library rendered');

  const tag = `verify-${Date.now()}`;
  const appTitle = `Renewals SOP (${tag})`;

  // ── Create a multi-step app via the real admin API (browser session cookies) ──
  const created = await page.evaluate(async (appTitle) => {
    const res = await fetch('/api/v1/admin/apps', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: appTitle,
        summary: 'Renewal outreach for the {{team}} team',
        visibility: 'private',
        trigger: { kind: 'on-demand' },
        steps: [
          {
            id: 's1',
            label: 'Draft',
            kind: 'agent',
            inlineAgent: { systemPrompt: 'Draft a renewal note for the {{team}} team.', grounded: false },
          },
          { id: 's2', label: 'Approve', kind: 'human' },
        ],
        edges: [{ from: 's1', to: 's2' }],
      }),
    });
    return { status: res.status, body: await res.json() };
  }, appTitle);
  assert.equal(created.status, 201, `create app failed: ${JSON.stringify(created.body)}`);
  const appId = created.body.id;
  console.log(`sop-verify: created app ${appId}`);

  // ── Publish it as an org template carrying the {{team}} variable ──
  const published = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/admin/apps/${id}/publish-as-template`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visibility: 'org',
        vars: [{ name: 'team', type: 'text', required: true, description: 'Owning team' }],
      }),
    });
    return { status: res.status, body: await res.json() };
  }, appId);
  assert.equal(published.status, 200, `publish failed: ${JSON.stringify(published.body)}`);
  console.log('sop-verify: published as org template');

  // ── The LIBRARY shows the template card ──
  await page.goto(`${baseUrl}/solutions/templates`, { waitUntil: 'networkidle' });
  const card = page.getByRole('link', { name: new RegExp(tag) }).first();
  await card.waitFor();
  await page.screenshot({ path: '/tmp/sop-template-library.png', fullPage: true });
  console.log('sop-verify: library shows the template card (screenshot saved)');

  // ── Open the detail (list → detail, deep-linkable) ──
  await card.click();
  await page.waitForURL(new RegExp(`/solutions/templates/${appId}$`));
  await page.waitForLoadState('networkidle');
  await page.getByText('Variables you fill in').waitFor({ timeout: 15_000 });
  assert.match(await page.locator('body').innerText(), /Variables you fill in/);
  assert.match(await page.locator('body').innerText(), /\{\{team\}\}/);
  await page.screenshot({ path: '/tmp/sop-template-detail.png', fullPage: true });
  console.log('sop-verify: detail renders workflow + variables');

  // ── Adopt: open the URL-driven form, fill the var, submit ──
  await page.getByRole('button', { name: 'Use this template' }).click();
  await page.waitForURL(/\?adopt=1$/);
  await page.locator('#var-team').fill('Claims');
  await page.getByRole('button', { name: 'Adopt into my workspace' }).click();
  await page.waitForURL(new RegExp('/solutions/apps/app_[a-f0-9]+'));
  const adoptedUrl = page.url();
  console.log(`sop-verify: adopted → ${adoptedUrl}`);

  // ── The adopted app carries the bound variable + a lineage chip ──
  const adoptedId = new URL(adoptedUrl).pathname.split('/').pop();
  const adoptedSpec = await page.evaluate(async (id) => {
    const res = await fetch(`/api/v1/admin/apps/${id}`);
    return res.json();
  }, adoptedId);
  const prompt = adoptedSpec.steps.find((s) => s.kind === 'agent')?.inlineAgent?.systemPrompt;
  assert.match(prompt, /Claims team/, `variable not bound in adopted app: ${prompt}`);
  assert.doesNotMatch(prompt, /\{\{team\}\}/, 'adopted app still has a raw placeholder');
  const bodyText = await page.locator('body').innerText();
  assert.match(bodyText, /Adopted from template/, 'lineage chip missing on the adopted app');
  await page.screenshot({ path: '/tmp/sop-adopted-app.png', fullPage: true });
  console.log('sop-verify: adopted app has {{team}} bound to "Claims" + lineage chip — VERIFIED');

  // ── No horizontal overflow at desktop width (full-width discipline) ──
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `desktop overflow ${overflow}px`);

  await context.close();
  console.log('sop-verify: ALL CHECKS PASSED');
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
}
