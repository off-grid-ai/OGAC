// Films the explainer slideshow into a video (Playwright records the page as it plays).
import { chromium } from 'playwright';
import { readdirSync, renameSync } from 'node:fs';

const HTML = process.env.HTML || '/tmp/explainer.html';
const VIDDIR = process.env.VIDDIR || '/tmp/vid';

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 900 },
  recordVideo: { dir: VIDDIR, size: { width: 1600, height: 900 } },
});
const page = await ctx.newPage();
await page.goto(`file://${HTML}`, { waitUntil: 'load' });
console.log('recording… (waiting for slideshow to finish)');
await page.waitForFunction('window.__done===true', null, { timeout: 240000 });
await page.waitForTimeout(600);
await ctx.close(); // flush video to disk
await browser.close();

const webm = readdirSync(VIDDIR).find((f) => f.endsWith('.webm'));
renameSync(`${VIDDIR}/${webm}`, `${VIDDIR}/explainer.webm`);
console.log('saved', `${VIDDIR}/explainer.webm`);
