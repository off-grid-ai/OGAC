import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1500,height:950}})).newPage();
p.setDefaultTimeout(60000);
const H='https://bharatunion-onprem-console.getoffgridai.co';
await p.goto(H+'/signin?callbackUrl=%2Foverview',{waitUntil:'domcontentloaded'});
await p.fill('input[name=username]','demo-bank@getoffgridai.co');
await p.fill('input[name=password]','OffGridDemo2026!');
await p.getByRole('button',{name:/^sign in$/i}).click(); await p.waitForTimeout(9000);

const pid='pl_system_ai_quality_judge__org_bharat';
await p.goto(`${H}/runtime/pipelines/${pid}`,{waitUntil:'domcontentloaded'});
await p.waitForTimeout(5000);

// Count FULL document loads. A soft (client) navigation fires no 'load'.
let fullLoads = 0;
p.on('load', () => { fullLoads++; });
const errs=[];
p.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,80)); });

// Click through the in-content nav the way a person does.
for (const label of ['Routing','Policy','Quality']) {
  const before = fullLoads;
  // expand the group that holds it, then click the item
  for (const g of ['CONFIGURE','GOVERN','ASSURE']) {
    const t = p.locator(`text=${g}`).first();
    if (await t.count()) await t.click().catch(()=>{});
  }
  await p.waitForTimeout(900);
  const link = p.locator(`a:has-text("${label}")`).first();
  if (!(await link.count())) { console.log(`${label}: link not found`); continue; }
  await link.click().catch(()=>{});
  await p.waitForTimeout(3500);
  console.log(`${label.padEnd(9)} url=${p.url().split('/').pop()}  fullDocumentLoads=${fullLoads-before}`);
}
if (errs.length) console.log('console errors:', [...new Set(errs)].slice(0,3).join(' | '));
await b.close();
