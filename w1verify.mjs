import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,120))); p.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=500)errs.push('500 '+r.url().replace('http://127.0.0.1',''));});
await p.goto('http://127.0.0.1/chat', { waitUntil: 'networkidle' });
if (await p.$('text=Continue with Keycloak')) { await p.click('text=Continue with Keycloak'); await p.waitForSelector('#username',{timeout:15000}); await p.fill('#username','mohammed.ali@wednesday.is'); await p.fill('#password','OffGrid-2026'); await Promise.all([p.waitForNavigation({waitUntil:'networkidle'}), p.click('#kc-login')]); }
await p.goto('http://127.0.0.1/projects', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
try { await p.click('text=Acme Support', {timeout:5000}); await p.waitForTimeout(1500); } catch(e){ errs.push('proj open: '+e.message.slice(0,60)); }
await p.screenshot({ path: '/tmp/w1-projdetail.png' });
await p.goto('http://127.0.0.1/chat', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
try { await p.click('text=Skills', {timeout:4000}); await p.waitForTimeout(1200); } catch(e){}
await p.screenshot({ path: '/tmp/w1-skillsbuilder.png' });
console.log('errors:', errs.length? errs.join(' | '):'NONE');
await b.close();
