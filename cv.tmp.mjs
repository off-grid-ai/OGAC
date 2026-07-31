import { chromium } from 'playwright';
const B='http://localhost:3000', OUT=process.env.OUT;
const br=await chromium.launch();
const p=await (await br.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.goto(`${B}/signin?callbackUrl=%2Fwork%2Fchat`,{waitUntil:'networkidle',timeout:25000});
await p.fill('input[name=username]','demo-bank@getoffgridai.co');
await p.fill('input[name=password]','OffGridDemo2026!');
await p.getByRole('button',{name:/^sign in$/i}).click(); await p.waitForTimeout(4000);
// A grounded answer needs a knowledge-bearing PROJECT chat — open the reimbursement project.
await p.goto(`${B}/work/chat`,{waitUntil:'networkidle',timeout:25000}); await p.waitForTimeout(2000);
const proj=p.getByText('Reimbursement queries').first();
if(await proj.count()){ await proj.click(); await p.waitForTimeout(3000); console.log('opened project chat'); }
const t=p.locator('textarea[aria-label="Message Off Grid AI"]');
await t.click();
await t.pressSequentially('What is the reimbursement limit for Training? Cite the policy.',{delay:20});
await t.press('Enter');
// The PASS CONDITION is a citation ROW: an <li> containing a [n] marker. Not the word "Sources".
const row=p.locator('li').filter({has:p.locator('span',{hasText:/^\[\d+\]$/})}).first();
let ok=false;
for(let i=0;i<24;i++){ await p.waitForTimeout(3000); if(await row.count()){ok=true;break;} }
console.log('citation ROW present:',ok);
if(ok){
  console.log('ROW TEXT:',JSON.stringify((await row.innerText()).slice(0,200)));
  const a=row.locator('a'); const n=await a.count();
  console.log('link count:',n,'href:',n?await a.first().getAttribute('href'):'—');
  await row.screenshot({path:`${OUT}/cite-row-final.png`}).catch(()=>console.log('row shot failed'));
}
await p.screenshot({path:`${OUT}/cite-final.png`});
await br.close();
