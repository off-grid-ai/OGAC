import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({viewport:{width:1600,height:1000}})).newPage();
p.setDefaultTimeout(60000);
await p.goto('http://localhost:3000/signin?callbackUrl=%2Foverview',{waitUntil:'domcontentloaded'});
await p.fill('input[name=username]', process.env.U);
await p.fill('input[name=password]', process.env.PW);
await p.getByRole('button',{name:/^sign in$/i}).click();
await p.waitForTimeout(7000);
console.log('signed in as', process.env.U, '| url', p.url());
const RUN='apprun_2da37694';
const call = (body) => p.evaluate(async ({run, body}) => {
  const r = await fetch(`/api/v1/admin/apps/runs/${run}/review`, {
    method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body),
  });
  return { status: r.status, body: (await r.text()).slice(0,260) };
}, {run: RUN, body});
console.log('no-reason:', JSON.stringify(await call({decision:'escalate'})));
console.log('with reason:', JSON.stringify(await call({decision:'escalate', note:'Above my limit — exposure over ₹20,00,000.', to:'regional.credit@bharatunion.co.in'})));
await b.close();
