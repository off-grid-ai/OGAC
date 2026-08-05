import { chromium } from 'playwright';
const BASE='http://127.0.0.1:3005';
const b=await chromium.launch(); const ctx=await b.newContext();
const csrf=(await (await ctx.request.get(`${BASE}/api/auth/csrf`,{timeout:120000})).json()).csrfToken;
await ctx.request.post(`${BASE}/api/auth/callback/dev`,{form:{csrfToken:csrf,email:'dev@offgrid.local',callbackUrl:`${BASE}/overview`},maxRedirects:0,timeout:120000}).catch(()=>{});
const routes=process.argv.slice(2);
for(const r of routes){
  try{
    const t0=Date.now();
    const res=await ctx.request.get(BASE+r,{maxRedirects:0,timeout:180000});
    const ms=Date.now()-t0; const body=res.status()<400? await res.text():'';
    const sig=[];
    if(/Page not found/.test(body))sig.push('404-PAGE');
    if(/[Cc]oming soon|SOON</.test(body))sig.push('COMING-SOON');
    if(/Unavailable/.test(body))sig.push('UNAVAILABLE');
    if(/went wrong|Application error/i.test(body))sig.push('ERROR-BOUNDARY');
    console.log(`${res.status()} ${String(ms).padStart(6)}ms ${r} ${res.headers()['location']??''} ${sig.join(',')}`);
  }catch(e){console.log(`ERR ${r} ${String(e.message).slice(0,60)}`);}
}
await b.close();
