// Off Grid fleet metrics dashboard — runs on S1, SSHes to each node, collects live
// CPU / memory / disk / load, and serves an auto-refreshing page. Dependency-free.
import { execFile } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.PORT || 9100);
const NODES = JSON.parse(process.env.OFFGRID_NODES || JSON.stringify([
  { name: 'offgrid-s1', role: 'Server · edge/db/keycloak/aggregator' },
  { name: 'offgrid-s2', role: 'Server · console (standby)' },
  { name: 'offgrid-g1', role: 'Gateway · inference' },
  { name: 'offgrid-g2', role: 'Gateway · inference' },
  { name: 'offgrid-g3', role: 'Gateway · inference' },
]));

const SSH = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null'];
const REMOTE =
  'TOP=$(top -l1 -n0 2>/dev/null); ' +
  'printf "H=%s\\nT=%s\\nC=%s\\nL=%s\\nCPU=%s\\nPM=%s\\nDF=%s\\nM=%s\\nUP=%s\\n" ' +
  '"$(scutil --get LocalHostName)" "$(sysctl -n hw.memsize)" "$(sysctl -n hw.ncpu)" ' +
  '"$(sysctl -n vm.loadavg)" "$(echo "$TOP"|grep "CPU usage")" "$(echo "$TOP"|grep PhysMem)" ' +
  '"$(df -k / | tail -1)" "$(cat ~/.offgrid/models/active-model.json 2>/dev/null|tr -d "\\n")" "$(uptime)"';

function sh(name) {
  return new Promise((res) => {
    execFile('ssh', [...SSH, `admin@${name}.local`, REMOTE], { timeout: 9000 }, (err, out) => {
      res(err ? null : out);
    });
  });
}
const g = (s, re, d = '') => (s.match(re)?.[1] ?? d);
function toGB(v, unit) { const n = parseFloat(v); return unit === 'M' ? n / 1024 : unit === 'K' ? n / 1024 / 1024 : n; }

async function collect(node) {
  const out = await sh(node.name);
  if (!out) return { ...node, up: false };
  const total = Number(g(out, /T=(\d+)/)) || 0;
  const idle = parseFloat(g(out, /CPU=.*?([\d.]+)%\s*idle/)) || 0;
  const cpu = out.includes('CPU=') ? Math.max(0, Math.round((100 - idle) * 10) / 10) : 0;
  const pm = out.match(/PhysMem:\s*([\d.]+)([MGK])\s*used/);
  const usedGB = pm ? toGB(pm[1], pm[2]) : 0;
  const totalGB = total ? total / 1e9 : 0;
  const cores = Number(g(out, /C=(\d+)/)) || 1;
  const load1 = parseFloat(g(out, /L=\{\s*([\d.]+)/)) || 0;
  const dfp = out.match(/DF=\S+\s+\d+\s+\d+\s+\d+\s+(\d+)%/);
  const disk = dfp ? Number(dfp[1]) : 0;
  const model = g(out, /"primary":"([^"]+)"/) || g(out, /M=.*?"id":"([^"]+)"/) || '—';
  const up = g(out, /UP=.*?up\s+([^,]+(?:,\s*\d+:\d+)?)/).replace(/\s+\d+ user.*/, '').trim();
  return { ...node, up: true, cpu, usedGB: Math.round(usedGB * 10) / 10, totalGB: Math.round(totalGB), memPct: totalGB ? Math.round((usedGB / totalGB) * 100) : 0, cores, load1, loadPct: Math.min(100, Math.round((load1 / cores) * 100)), disk, model, uptime: up };
}

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Off Grid — Fleet Metrics</title>
<style>
:root{--accent:#059669;--mono:'Menlo','SF Mono',ui-monospace,monospace;--border:#e6e8eb;--muted:#6b7280}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#0a0a0a;font-family:var(--mono);font-size:14px}
.wrap{max-width:1200px;margin:0 auto;padding:26px 22px}
.hd{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:14px;margin-bottom:20px}
.hd h1{font-size:20px;margin:0;font-weight:700}.hd .sub{color:var(--muted);font-size:12px;letter-spacing:.06em}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.card{border:1px solid var(--border);border-radius:14px;padding:16px;background:#fff}
.card.down{opacity:.55}
.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:3px}
.nm{font-weight:700;font-size:15px}.dot{width:8px;height:8px;border-radius:50%;background:var(--accent);display:inline-block;margin-right:6px}
.dot.off{background:#dc2626}
.role{color:var(--muted);font-size:11px;margin-bottom:12px}
.model{display:inline-block;font-size:11px;background:rgba(5,150,105,.08);color:var(--accent);border:1px solid rgba(5,150,105,.25);border-radius:6px;padding:2px 7px;margin-bottom:12px}
.met{margin:9px 0}
.met .lab{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-bottom:3px}
.met .lab b{color:#0a0a0a;font-weight:700}
.bar{height:7px;background:#f0f1f3;border-radius:6px;overflow:hidden}
.bar span{display:block;height:100%;border-radius:6px;transition:width .4s}
.foot{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:10px;border-top:1px solid var(--border);padding-top:8px}
</style></head><body><div class="wrap">
<div class="hd"><div><h1>Off Grid — Fleet Metrics</h1><div class="sub">ON-PREM · LIVE · refreshes every 5s</div></div><div class="sub" id="ts"></div></div>
<div class="grid" id="grid"></div></div>
<script>
const col=p=>p<70?'#059669':p<88?'#d97706':'#dc2626';
function bar(lab,val,pct,unit){return '<div class="met"><div class="lab"><span>'+lab+'</span><b>'+val+(unit||'')+'</b></div><div class="bar"><span style="width:'+pct+'%;background:'+col(pct)+'"></span></div></div>';}
async function tick(){
  let d; try{ d=await (await fetch('/api')).json(); }catch{ return; }
  document.getElementById('ts').textContent=new Date().toLocaleTimeString();
  document.getElementById('grid').innerHTML=d.map(n=>{
    if(!n.up) return '<div class="card down"><div class="top"><span class="nm"><span class="dot off"></span>'+n.name+'</span></div><div class="role">'+n.role+'</div><p style="color:#dc2626;font-size:12px">unreachable</p></div>';
    return '<div class="card"><div class="top"><span class="nm"><span class="dot"></span>'+n.name+'</span><span class="sub" style="color:#9ca3af;font-size:11px">'+n.cores+' cores</span></div>'+
      '<div class="role">'+n.role+'</div><div class="model">'+n.model+'</div>'+
      bar('CPU',n.cpu,n.cpu,'%')+
      bar('Memory',n.usedGB+' / '+n.totalGB+' GB',n.memPct,'')+
      bar('Load (1m)',n.load1,n.loadPct,'')+
      bar('Disk',n.disk,n.disk,'%')+
      '<div class="foot"><span>up '+n.uptime+'</span></div></div>';
  }).join('');
}
tick(); setInterval(tick,5000);
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  if (req.url === '/api') {
    const data = await Promise.all(NODES.map(collect));
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(data));
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(HTML);
});
server.listen(PORT, '0.0.0.0', () => console.log(`[metrics] dashboard on 0.0.0.0:${PORT}`));
