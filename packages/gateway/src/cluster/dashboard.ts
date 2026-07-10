// Built-in status dashboard — the gateway's own product face.
//
// The cluster gateway is an OpenAI-compatible API, but a thing people run
// standalone deserves a UI without needing the console. This is a single,
// self-contained HTML page (no deps, no build, no external assets) served at /
// to browsers; it polls /traffic every 2s and renders per-node health, live
// backpressure gauges, and recent calls. Off Grid terminal aesthetic:
// Menlo mono, near-black ground, emerald accent.

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Off Grid · Gateway</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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" />
<style>
  :root { --ground:#0a0a0a; --panel:#111; --line:#262626; --text:#e5e5e5; --dim:#8a8a8a; --up:#34d399; --warn:#f59e0b; --down:#ef4444; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--text); font:13px/1.5 Menlo,ui-monospace,SFMono-Regular,monospace; }
  header { display:flex; align-items:baseline; gap:14px; padding:18px 22px; border-bottom:1px solid var(--line); }
  header h1 { margin:0; font-size:15px; letter-spacing:.02em; }
  header h1 b { color:var(--up); }
  header .sub { color:var(--dim); font-size:11px; }
  header .live { margin-left:auto; color:var(--up); font-size:11px; display:flex; align-items:center; gap:6px; }
  header .live .pulse { width:7px; height:7px; border-radius:50%; background:var(--up); animation:p 1.6s infinite; }
  @keyframes p { 0%,100%{opacity:1} 50%{opacity:.3} }
  main { padding:22px; max-width:1200px; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:26px 0 12px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
  .node { border:1px solid var(--line); border-radius:8px; padding:13px 15px; background:var(--panel); }
  .node .top { display:flex; align-items:center; justify-content:space-between; }
  .node .name { display:flex; align-items:center; gap:7px; font-weight:600; }
  .dot { width:8px; height:8px; border-radius:50%; }
  .up .dot{background:var(--up)} .degraded .dot{background:var(--warn)} .down .dot{background:var(--down)} .unknown .dot{background:var(--dim)}
  .up .st{color:var(--up)} .degraded .st{color:var(--warn)} .down .st{color:var(--down)} .unknown .st{color:var(--dim)}
  .st { font-size:10px; text-transform:uppercase; letter-spacing:.05em; }
  .node .model { color:var(--dim); font-size:11px; margin:3px 0 10px; }
  .row { display:flex; justify-content:space-between; padding:1px 0; color:var(--dim); }
  .row b { color:var(--text); font-weight:500; }
  .row.bp { border-top:1px dashed var(--line); margin-top:6px; padding-top:6px; }
  .row.bp .q { color:var(--warn); }
  .row.bp .f { color:var(--up); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th { text-align:left; color:var(--dim); font-weight:500; font-size:10px; text-transform:uppercase; letter-spacing:.06em; padding:7px 10px; border-bottom:1px solid var(--line); }
  td { padding:7px 10px; border-bottom:1px solid #191919; }
  td.tag { color:var(--up); }
  td.err { color:var(--down); }
  .empty { color:var(--dim); padding:26px; text-align:center; }
  .scroll { overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--panel); }
</style>
</head>
<body>
  <header>
    <h1>OFF&nbsp;GRID <b>/</b> gateway</h1>
    <span class="sub" id="sub">connecting…</span>
    <span class="live"><span class="pulse"></span> live</span>
  </header>
  <main>
    <h2>Nodes &amp; backpressure</h2>
    <div class="grid" id="nodes"></div>
    <h2>Recent calls</h2>
    <div class="scroll"><table>
      <thead><tr><th>time</th><th>node</th><th>model</th><th>status</th><th>ttfb</th><th>latency</th><th>tok/s</th><th>tokens</th></tr></thead>
      <tbody id="recent"></tbody>
    </table></div>
  </main>
<script>
  var esc = function(s){ return String(s==null?'':s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];}); };
  function nodeCard(s){
    var h = s.health || 'unknown';
    return '<div class="node '+h+'">'
      + '<div class="top"><span class="name"><span class="dot"></span>'+esc(s.gateway)+'</span><span class="st">'+h+'</span></div>'
      + '<div class="model">'+esc(s.model)+'</div>'
      + '<div class="row">requests <b>'+s.requests+'</b></div>'
      + '<div class="row">errors <b>'+s.errors+'</b></div>'
      + '<div class="row">avg latency <b>'+s.avgMs+' ms</b></div>'
      + '<div class="row">tokens <b>'+s.tokens+'</b></div>'
      + (s.inflight!==undefined ? '<div class="row bp">in-flight <b class="f">'+s.inflight+'</b></div>'
          + '<div class="row bp" style="border:0;margin:0;padding:1px 0">queued <b class="q">'+(s.queued||0)+'</b></div>'
          + '<div class="row" >peak <b>'+(s.peakInflight||0)+'</b></div>' : '')
      + '</div>';
  }
  function row(c){
    var t = new Date(c.ts).toLocaleTimeString();
    var bad = !c.status || c.status>=400;
    return '<tr><td>'+t+'</td><td class="tag">'+esc(c.gateway)+'</td><td>'+esc(c.model)+'</td>'
      + '<td class="'+(bad?'err':'')+'">'+c.status+'</td>'
      + '<td>'+(c.ttfb!=null?c.ttfb+' ms':'—')+'</td>'
      + '<td>'+c.ms+' ms</td><td>'+(c.tps||'—')+'</td><td>'+(c.tokens||'—')+'</td></tr>';
  }
  function tick(){
    fetch('/traffic',{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){
      var up = (d.stats||[]).filter(function(s){return s.health==='up';}).length;
      document.getElementById('sub').textContent = (d.stats||[]).length+' nodes · '+up+' up · since '+ (d.since? new Date(d.since).toLocaleTimeString():'—');
      document.getElementById('nodes').innerHTML = (d.stats||[]).map(nodeCard).join('');
      var r = (d.recent||[]).slice(0,40);
      document.getElementById('recent').innerHTML = r.length ? r.map(row).join('') : '<tr><td colspan="8" class="empty">no traffic yet — calls through the gateway appear here</td></tr>';
    }).catch(function(){ document.getElementById('sub').textContent='gateway unreachable'; });
  }
  tick(); setInterval(tick, 2000);
</script>
</body>
</html>`;
