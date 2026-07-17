import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import 'dotenv/config';
import { chromium } from 'playwright';
import { prepareSolutionSchema } from '../test/support/solution-schema.mjs';

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before readiness.\n${logs.join('')}`);
    }
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready.\n${logs.join('')}`);
}

function field(page, label) {
  return page.locator('label').filter({ hasText: label });
}

const database = await prepareSolutionSchema('browser_ui');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const logs = [];
const server = spawn(
  process.execPath,
  [
    path.resolve('node_modules/next/dist/bin/next'),
    'dev',
    '--hostname',
    '127.0.0.1',
    '--port',
    String(port),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: database.databaseUrl,
      AUTH_DEV_LOGIN: 'true',
      AUTH_SECRET: 'solutions-browser-verification-secret-with-32-bytes',
      OFFGRID_ORG: 'default',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  },
);
for (const stream of [server.stdout, server.stderr]) {
  stream.on('data', (chunk) => {
    logs.push(String(chunk));
    if (logs.length > 200) logs.shift();
  });
}

let browser;
try {
  await waitForServer(`${baseUrl}/signin`, server, logs);
  console.log('solutions-ui: server ready');
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: { 'x-forwarded-proto': 'http' },
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/signin?callbackUrl=%2Fsolutions%2Flibrary`, {
    waitUntil: 'networkidle',
  });
  console.log('solutions-ui: sign-in rendered');
  await page.getByRole('button', { name: 'Dev sign-in' }).click();
  await page.waitForURL('**/solutions/library');
  console.log('solutions-ui: authenticated library rendered');

  const createSummary = page.getByText('Create a custom blueprint', { exact: true });
  await createSummary.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Blueprint name').fill('Browser verified claims acceleration');
  await page.getByLabel('Industry').fill('Insurance');
  await page.getByLabel('Process').fill('Claims');
  await page.getByLabel('Business owner').fill('Claims COO');
  await page.getByLabel('Required data domains').fill('claims');
  await page.getByLabel('Required capabilities').fill('grounded-inference');
  await page.getByLabel('Required governed pipeline').fill('claims-acceleration');
  await page.getByLabel('Source app template').fill('claims-acceleration');
  await page
    .getByLabel('What business outcome does this solve?')
    .fill('Process ten times more claims with the same workforce.');
  await page.getByLabel('KPI', { exact: true }).fill('Claims processed daily');
  await page.getByLabel('Unit', { exact: true }).fill('claims/day');
  await page.getByLabel('Measurement window').fill('30 days');
  await field(page, 'Baseline').locator('input').nth(0).fill('Current throughput');
  await field(page, 'Baseline').locator('input').nth(1).fill('500');
  await field(page, 'Target').locator('input').nth(0).fill('Target throughput');
  await field(page, 'Target').locator('input').nth(1).fill('5000');
  await page.getByLabel('Currency').fill('INR');
  await page.getByLabel('Annual benefit').fill('9000000');
  await page.getByLabel('Implementation cost').fill('1000000');
  await page.getByLabel('Annual operating cost').fill('500000');
  await page
    .getByLabel('ROI rationale')
    .fill('Higher throughput avoids equivalent workforce expansion.');

  const createButton = page.getByRole('button', { name: 'Create blueprint' });
  await createButton.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/solutions\/library\/[^/]+$/);
  console.log('solutions-ui: keyboard create routed to detail');
  assert.match(await page.getByText(/₹/).first().innerText(), /₹/);
  const detailUrl = page.url();

  await page.goBack({ waitUntil: 'networkidle' });
  assert.equal(new URL(page.url()).pathname, '/solutions/library');
  await page.reload({ waitUntil: 'networkidle' });
  const createdLink = page.getByRole('link', { name: /Browser verified claims acceleration/ });
  await createdLink.focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(detailUrl);
  console.log('solutions-ui: back and keyboard detail navigation verified');

  const editSummary = page.getByText('Edit blueprint contract', { exact: true });
  await editSummary.focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Currency').fill('invalid-currency');
  await page.getByRole('button', { name: 'Create new version' }).click();
  const formAlert = page.locator('form [role="alert"]');
  await assert.doesNotReject(() => formAlert.waitFor());
  assert.match(await formAlert.innerText(), /ISO code/);
  assert.equal(page.url(), detailUrl, 'a failed action must not corrupt navigation history');
  console.log('solutions-ui: server error state verified');

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  assert(overflow <= 1, `mobile viewport has ${overflow}px of horizontal overflow`);
  await page.screenshot({
    path: process.env.SOLUTION_UI_SCREENSHOT ?? '/tmp/offgrid-solution-blueprint-mobile.png',
    fullPage: true,
  });
  await context.close();
  console.log(`Solutions UI verified at desktop and mobile widths: ${detailUrl}`);
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill('SIGTERM');
  }
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once('exit', resolve);
    setTimeout(() => {
      try {
        process.kill(-server.pid, 'SIGKILL');
      } catch {
        server.kill('SIGKILL');
      }
      resolve();
    }, 5_000);
  });
  await database.cleanup();
}
