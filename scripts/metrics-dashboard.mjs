// Off Grid fleet dashboard — runs on S1. Two tabs: LIVE metrics (SSHes each node for
// CPU/mem/disk/load) and a HANDBOOK (topology, access, services, health, fix, ops).
// Dependency-free Node http.
import { execFile } from 'node:child_process';
import http from 'node:http';

const PORT = Number(process.env.PORT || 9100);
const NODES = JSON.parse(process.env.OFFGRID_NODES || JSON.stringify([
  { name: 'offgrid-s1', role: 'Server · edge/db/keycloak/aggregator/metrics' },
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
    execFile('ssh', [...SSH, `admin@${name}.local`, REMOTE], { timeout: 9000 }, (err, out) => res(err ? null : out));
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

const BOOK = `
<h2>1 · WHAT RUNS WHERE</h2>
<p>Reach every node by its stable mDNS name (<code>*.local</code>) — survives IP changes.</p>
<table><tr><th>Node</th><th>IP</th><th>Role</th><th>Runs</th></tr>
<tr><td><b>offgrid-s1</b></td><td>127.0.0.1</td><td>Server / control plane</td><td>Caddy edge :80 · Postgres :5432 · Keycloak :8080 · aggregator :8800 · metrics :9100 · Console :3000</td></tr>
<tr><td><b>offgrid-s2</b></td><td>192.168.1.60</td><td>Console (standby)</td><td>Console :3000 (shares S1 Postgres)</td></tr>
<tr><td><b>offgrid-g1</b></td><td>192.168.1.57</td><td>Gateway · inference</td><td>Gemma 4 12B — text/general</td></tr>
<tr><td><b>offgrid-g2</b></td><td>192.168.1.58</td><td>Gateway · inference</td><td>Qwen 3.5 9B — text + vision</td></tr>
<tr><td><b>offgrid-g3</b></td><td>192.168.1.32</td><td>Gateway · inference</td><td>Gemma 4 E4B — vision</td></tr></table>
<p>All nodes: user <code>admin</code>, sleep disabled (lids can stay closed). LAN-only — nothing exposed to the internet.</p>

<h2>2 · URLS & ACCESS</h2>
<table><tr><th>What</th><th>URL</th></tr>
<tr><td>Console (the one IP)</td><td><code>http://127.0.0.1</code></td></tr>
<tr><td>Metrics + handbook</td><td><code>http://127.0.0.1:9100</code></td></tr>
<tr><td>Gateway (aggregator)</td><td><code>http://127.0.0.1:8800/v1</code></td></tr>
<tr><td>Keycloak</td><td><code>http://127.0.0.1:8080</code> · admin <code>admin/offgrid-dev</code></td></tr></table>
<p>Console login: <code>mac@ · mohammed.ali@ · diksha.sharma@ · ali@wednesday.is</code> / <code>OffGrid-2026</code>. Use a fresh window after any restart.</p>

<h2>3 · SERVICES (how each stays up)</h2>
<ul>
<li><b>S1 LaunchDaemons</b> (root): <code>co.getoffgridai.edge</code> (:80) · <code>.aggregator</code> (:8800) · <code>.metrics</code> (:9100)</li>
<li><b>S1 & S2 LaunchAgent</b>: <code>co.getoffgridai.console</code> (:3000, via <code>start-console.sh</code>)</li>
<li><b>g1/g2/g3 LaunchAgent</b>: <code>co.getoffgridai.gateway</code> (:7878, Desktop <code>--server-only</code>)</li>
<li><b>S1 OrbStack containers</b> (<code>restart: unless-stopped</code>): postgres :5432 · keycloak :8080</li>
</ul>
<p>All launchd jobs use <code>KeepAlive</code> → auto-restart on crash.</p>

<h2>4 · HEALTH CHECK</h2>
<pre>cd console/deploy/onprem && ./recover.sh health   # PASS/FAIL for all services + end-to-end inference

curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1/signin        # console 200
curl -s http://127.0.0.1:8800/v1/models                                  # models
for ip in 57 58 32; do curl -s -o /dev/null -w "g.$ip %{http_code}\\n" http://192.168.1.$ip:7878/health; done</pre>

<h2>5 · FIX IT</h2>
<pre># bring everything back to known-good (resolves IPs by name, restarts all):
cd console/deploy/onprem && ./recover.sh

# restart one service (ssh to the node first):
sudo launchctl kickstart -k system/co.getoffgridai.edge         # or .aggregator / .metrics
launchctl kickstart -k gui/$(id -u)/co.getoffgridai.console     # or .gateway on g1/g2/g3</pre>
<p>Logs: <code>/tmp/offgrid-{edge,aggregator,metrics}.log</code> · <code>~/offgrid/console/deploy/console.log</code> · <code>~/gateway.log</code> (gateways). After a network change, <code>./recover.sh</code> re-points config to the new IPs.</p>

<h2>6 · COMMON OPS</h2>
<p><b>Swap a gateway's model</b> (e.g. g1): download the GGUF (+ mmproj if vision) to <code>~/.offgrid/models/</code>, write <code>active-model.json</code> <code>{"id","primary","mmproj"}</code>, then <code>launchctl kickstart -k gui/$(id -u)/co.getoffgridai.gateway</code>, and update the aggregator <code>POOL</code>.</p>
<p><b>Aggregator routing</b> (<code>scripts/gateway-aggregator.mjs</code>): text → g1/g2 round-robin; image or <code>model:gemma</code> → a vision gateway.</p>
<p><b>Add a gateway:</b> enable Remote Login + copy key + NOPASSWD sudo + <code>pmset disablesleep 1</code>; rsync the Desktop app + model; install the gateway LaunchAgent; add its IP to the aggregator <code>POOL</code>.</p>
<p style="color:#9ca3af;margin-top:14px">Full detail: <code>console/deploy/onprem/HANDBOOK.md</code></p>
`;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Off Grid — Fleet Metrics</title>
<style>
:root{--accent:#059669;--mono:'Menlo','SF Mono',ui-monospace,monospace;--border:#e6e8eb;--muted:#6b7280}
*{box-sizing:border-box}body{margin:0;background:#fff;color:#0a0a0a;font-family:var(--mono);font-size:14px}
.wrap{max-width:1200px;margin:0 auto;padding:26px 22px}
.hd{display:flex;align-items:center;justify-content:space-between;padding-bottom:12px}
.hd h1{font-size:20px;margin:0;font-weight:700}.hd .sub{color:var(--muted);font-size:12px;letter-spacing:.06em}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--border);margin-bottom:20px}
.tabs button{border:none;background:none;font-family:var(--mono);font-size:13px;font-weight:700;color:var(--muted);padding:9px 14px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs button.on{color:#0a0a0a;border-bottom-color:var(--accent)}
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
.book{max-width:940px}
.book h2{font-size:13px;letter-spacing:.1em;color:var(--accent);margin:24px 0 9px;font-weight:700}
.book h2:first-child{margin-top:0}
.book table{width:100%;border-collapse:collapse;font-size:12.5px;margin:2px 0 8px}
.book th,.book td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);vertical-align:top}
.book th{color:var(--muted);font-weight:700;font-size:11px;letter-spacing:.06em}
.book code{background:#f4f5f6;border-radius:5px;padding:1px 5px;font-size:12px}
.book pre{background:#0f1115;color:#e6e8eb;border-radius:10px;padding:12px 14px;overflow:auto;font-size:12px;line-height:1.55;margin:6px 0}
.book ul{margin:4px 0 10px;padding-left:18px}.book li{margin:3px 0;font-size:12.5px}
.book p{font-size:12.5px;color:#374151;margin:6px 0}
</style></head><body><div class="wrap">
<div class="hd"><div><h1>Off Grid — Fleet</h1><div class="sub">ON-PREM · LOCAL-FIRST</div></div><div class="sub" id="ts"></div></div>
<div class="tabs"><button id="tl" class="on" onclick="tab('live')">Live metrics</button><button id="tb" onclick="tab('book')">Handbook</button></div>
<div id="live"><div class="grid" id="grid"></div></div>
<div id="book" class="book" style="display:none">${BOOK}</div>
</div>
<script>
function tab(t){live.style.display=t==='live'?'':'none';book.style.display=t==='book'?'':'none';tl.classList.toggle('on',t==='live');tb.classList.toggle('on',t==='book');}
const col=p=>p<70?'#059669':p<88?'#d97706':'#dc2626';
function bar(lab,val,pct,unit){return '<div class="met"><div class="lab"><span>'+lab+'</span><b>'+val+(unit||'')+'</b></div><div class="bar"><span style="width:'+pct+'%;background:'+col(pct)+'"></span></div></div>';}
async function tick(){
  let d; try{ d=await (await fetch('/api')).json(); }catch{ return; }
  ts.textContent='updated '+new Date().toLocaleTimeString();
  grid.innerHTML=d.map(n=>{
    if(!n.up) return '<div class="card down"><div class="top"><span class="nm"><span class="dot off"></span>'+n.name+'</span></div><div class="role">'+n.role+'</div><p style="color:#dc2626;font-size:12px">unreachable</p></div>';
    return '<div class="card"><div class="top"><span class="nm"><span class="dot"></span>'+n.name+'</span><span style="color:#9ca3af;font-size:11px">'+n.cores+' cores</span></div>'+
      '<div class="role">'+n.role+'</div><div class="model">'+n.model+'</div>'+
      bar('CPU',n.cpu,n.cpu,'%')+bar('Memory',n.usedGB+' / '+n.totalGB+' GB',n.memPct,'')+
      bar('Load (1m)',n.load1,n.loadPct,'')+bar('Disk',n.disk,n.disk,'%')+
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
