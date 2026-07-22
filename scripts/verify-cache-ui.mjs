import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  return port;
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Next exited early.\n${logs.join('')}`);
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Next not ready.\n${logs.join('')}`);
}

const REPO = path.resolve(process.cwd());
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];
const server = spawn(
  process.execPath,
  [nextBin, 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: REPO,
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://offgrid@localhost:5432/offgrid_console',
      AUTH_DEV_LOGIN: 'true',
      AUTH_SECRET: 'cache-browser-verification-secret-with-32-bytes!!',
      OFFGRID_ORG: 'default',
      // OFFGRID_LITELLM_URL intentionally UNSET → exercises the honest "not configured" render.
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
  console.log('cache-ui: server ready');
  browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
  });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}/signin?callbackUrl=%2Fruntime%2Fmodels%2Fcache`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Dev sign-in/i }).click();
  await page.waitForURL('**/runtime/models/cache**', { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  console.log('cache-ui: authenticated cache page rendered');

  await page.getByRole('heading', { name: /Response cache/i }).waitFor({ timeout: 15_000 });
  await page.getByText('Cache effectiveness', { exact: true }).waitFor();
  await page.getByText('Cache status', { exact: true }).waitFor();
  await page.getByText('Cache actions', { exact: true }).waitFor();
  console.log('cache-ui: all three panels present');

  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await page.waitForURL(/range=7d/, { timeout: 10_000 });
  console.log('cache-ui: range switch is URL-driven (range=7d)');
  await page.goBack({ waitUntil: 'networkidle' });
  assert.ok(!/range=7d/.test(page.url()), 'Back should step out of range=7d');
  console.log('cache-ui: Back is history-coherent');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `desktop overflow ${overflow}px`);

  await page.screenshot({ path: path.resolve(REPO, 'cache-ui.png'), fullPage: true });
  console.log('cache-ui: screenshot written; VERIFIED');
} catch (e) {
  console.error('cache-ui: FAILED', e.message);
  console.error(logs.slice(-40).join(''));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid);
  } catch {}
}
