#!/usr/bin/env node
// Live viewer for harbor pi-agent runs — pi-export-style rendering.
//
// Accepts a job directory or a single trial directory (siblings are discovered
// either way, so you always get a trial picker).
//
// Serves:
//   /              wrapper page: trial picker + iframe, polls /version each second
//   /trials        JSON list of trial names that have pi sessions
//   /version?t=    freshness probe per trial: <file>-<mtimeMs>-<size> (re-exports on change)
//   /export?t=     the pi-exported HTML for that trial (scroll helper injected)
//
// Usage: pi-replay.js <job-or-trial-dir>

'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var execFileSync = require('child_process').execFileSync;
var spawn = require('child_process').spawn;

var rootArg = process.argv[2];
if (!rootArg) {
  console.error('usage: pi-replay.js <job-or-trial-dir>');
  process.exit(1);
}
rootArg = path.resolve(rootArg);
if (!fs.existsSync(rootArg)) {
  console.error('no such directory: ' + rootArg);
  process.exit(1);
}

// figure out whether we were handed a trial dir or a job dir
var jobDir;
if (fs.existsSync(path.join(rootArg, 'agent', 'pi', 'sessions'))) {
  jobDir = path.dirname(rootArg); // trial given -> its parent job
} else {
  jobDir = rootArg;               // assume job dir
}

function trialHasSessions(name) {
  var d = path.join(jobDir, name, 'agent', 'pi', 'sessions');
  try {
    return fs.readdirSync(d).some(function (f) { return f.endsWith('.jsonl'); });
  } catch (e) { return false; }
}

function listTrials() {
  var names;
  try {
    names = fs.readdirSync(jobDir).filter(function (n) {
      try { return fs.statSync(path.join(jobDir, n)).isDirectory(); } catch (e) { return false; }
    });
  } catch (e) { return []; }
  return names.filter(trialHasSessions).sort();
}

function trialStatus(name) {
  try {
    var raw = fs.readFileSync(path.join(jobDir, name, 'result.json'), 'utf8');
    var res = JSON.parse(raw);
    var reward = res && res.verifier_result && res.verifier_result.rewards && res.verifier_result.rewards.reward;
    if (typeof reward === 'number') return reward >= 1 ? 'pass' : reward <= 0 ? 'fail' : 'part:' + reward;
    return 'err';
  } catch (e) {
    return 'running'; // no result.json yet
  }
}

function latestSession(trial) {
  var d = path.join(jobDir, trial, 'agent', 'pi', 'sessions');
  var files;
  try {
    files = fs.readdirSync(d).filter(function (f) { return f.endsWith('.jsonl'); });
  } catch (e) { return null; }
  var ranked = files.map(function (f) {
    var p = path.join(d, f);
    return { p: p, t: fs.statSync(p).mtimeMs, s: fs.statSync(p).size };
  }).sort(function (a, b) { return b.t - a.t; });
  return ranked.length ? ranked[0] : null;
}

// per-trial export cache: /tmp/pi-replay-<hash(job)>/<trial>.html
var workRoot = path.join(os.tmpdir(), 'pi-replay-' + crypto.createHash('md5').update(jobDir).digest('hex').slice(0, 12));
function exportPathFor(trial) { return path.join(workRoot, trial + '.html'); }

var SCROLL_HELPER = '<script>(function(){var k="pi-replay-view";var p=null;try{p=JSON.parse(sessionStorage.getItem(k))}catch(e){}var h=document.body.scrollHeight;var y=h;if(p&&p.h===h)y=p.y;window.scrollTo(0,y);addEventListener("scroll",function(){try{sessionStorage.setItem(k,JSON.stringify({h:document.body.scrollHeight,y:window.scrollY}))}catch(e){}})})();</script>';

var lastKey = {};   // trial -> exported version key
var exporting = {}; // trial -> true while in-flight

function keyOf(s) { return s ? path.basename(s.p) + '-' + s.t + '-' + s.s : null; }

function reexport(trial) {
  if (exporting[trial]) return;
  var s = latestSession(trial);
  if (!s) return;
  var k = keyOf(s);
  if (k === lastKey[trial]) return; // unchanged since last export
  lastKey[trial] = k;
  exporting[trial] = true;
  var tmp = exportPathFor(trial) + '.tmp';
  try {
    fs.mkdirSync(workRoot, { recursive: true });
    execFileSync('pi', ['--export', s.p, tmp], { stdio: ['ignore', 'ignore', 'ignore'] });
    var html = fs.readFileSync(tmp, 'utf8');
    html = html.replace('</body>', SCROLL_HELPER + '</body>');
    fs.writeFileSync(exportPathFor(trial) + '.tmp2', html);
    fs.unlinkSync(tmp);
    fs.renameSync(exportPathFor(trial) + '.tmp2', exportPathFor(trial));
  } catch (e) {
    console.error('export failed for ' + trial + ': ' + e.message);
    lastKey[trial] = null; // allow retry on next poll
  } finally {
    exporting[trial] = false;
  }
}

var WRAPPER = [
'<!doctype html>',
'<html><head><meta charset="utf-8"><title>pi replay</title><style>',
'html,body{margin:0;height:100%;background:#111;color-scheme:dark;overflow:hidden;}',
'#wrap{display:flex;height:100%;}',
'#side{width:280px;min-width:200px;background:#161616;border-right:1px solid #2a2a2a;display:flex;flex-direction:column;font:13px ui-monospace,monospace;color:#ccc;}',
'#side h1{font-size:12px;margin:0;padding:10px 12px;color:#888;border-bottom:1px solid #2a2a2a;display:flex;justify-content:space-between;font-weight:normal;}',
'#score{padding:7px 12px;font-size:12px;color:#9ab;border-bottom:1px solid #2a2a2a;}',
'#score b{color:#7c7;}',
'#list{overflow-y:auto;flex:1;}',
'.t{padding:7px 12px;cursor:pointer;display:flex;gap:9px;align-items:baseline;border-bottom:1px solid #1d1d1d;}',
'.t:hover{background:#1f1f1f;}',
'.t.sel{background:#26303a;color:#fff;}',
'.g{width:14px;text-align:center;flex:none;}',
'.t.pass .g{color:#5c5;}',
'.t.fail .g{color:#d55;}',
'.t.running .g{color:#889;}',
'.spin{display:inline-block;width:11px;height:11px;border:2px solid #445;border-top-color:#9ad;border-radius:50%;animation:spin 0.9s linear infinite;}',
'@keyframes spin{to{transform:rotate(360deg)}}',
'.t.err .g{color:#da5;}',
'.t.part .g{color:#da5;}',
'.name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
'#status{padding:6px 12px;font-size:11px;color:#778;border-top:1px solid #2a2a2a;min-height:14px;}',
'#main{flex:1;position:relative;background:#111;}',
'iframe{position:absolute;top:0;left:0;width:100%;height:100%;border:0;background:#111;color-scheme:dark;}',
'iframe.pending{opacity:0;}',
'</style></head><body>',
'<div id="wrap">',
'<div id="side"><h1>trials <span id="count"></span></h1><div id="score"></div><div id="list"></div><div id="status"></div></div>',
'<div id="main"><iframe id="frame"></iframe></div>',
'</div>',
'<script>',
'var current=null,shown="",loading="",pending=null,lastSwap=0;',
'var SWAP_MIN_MS=3000;',
'var listEl=document.getElementById("list"),frame=document.getElementById("frame"),status=document.getElementById("status"),count=document.getElementById("count"),scoreEl=document.getElementById("score");',
'var statusMap={};',
'function trialFromHash(){var m=location.hash.match(/t=([^&]+)/);return m?decodeURIComponent(m[1]):null;}',
'function glyph(st){return st==="pass"?"✓":st==="fail"?"✗":st==="running"?"…":"⚠";}',
'function label(st){return st==="pass"?"pass":st==="fail"?"fail":st==="running"?"running":st==="err"?"error":st;}',
'function render(list){',
'  list.sort(function(a,b){return b.m-a.m;});',
'  count.textContent="("+list.length+")";',
'  var pass=0,scored=0;',
'  list.forEach(function(x){if(x.st==="pass")pass++;if(x.st==="pass"||x.st==="fail"||x.st==="part")scored++;});',
'  var ratio=scored?pass/scored:0;',
'  var txt=(Math.floor(ratio*100)/100).toFixed(2);',
'  scoreEl.innerHTML="<b>"+pass+"</b>/"+scored+" scored &middot; "+txt;',
'  while(listEl.firstChild)listEl.removeChild(listEl.firstChild);',
'  list.forEach(function(x){',
'    var row=document.createElement("div");',
'    row.className="t "+x.st+(x.n===current?" sel":"");',
'    row._t=x.n;',
'    var g=document.createElement("span");',
'    g.className="g";',
'    if(x.st==="running"){',
'      var sp=document.createElement("span");',
'      sp.className="spin";',
'      g.textContent="";',
'      g.appendChild(sp);',
'    } else {',
'      g.textContent=glyph(x.st);',
'    }',
'    g.title=x.st;',
'    var n=document.createElement("span");',
'    n.className="name";',
'    n.textContent=x.n;',
'    row.appendChild(g);row.appendChild(n);',
'    row.onclick=function(){select(x.n);};',
'    listEl.appendChild(row);',
'  });',
'  if(current){',
'    var st=statusMap[current]||"";',
'    status.textContent=st==="running"?"\u25CB running":label(st);',
'  }',
'}',
'function select(name){',
'  current=name;shown="";loading="";lastSwap=0;',
'  if(pending){pending.remove();pending=null;}',
'  location.hash="t="+encodeURIComponent(name);',
'  frame.src="/export?t="+encodeURIComponent(name);',
'  status.textContent=label(statusMap[name]||"");',
'  Array.prototype.forEach.call(listEl.children,function(el){el.className="t "+(statusMap[el._t]||"")+(el._t===current?" sel":"");});',
'}',
'function show(el){',
'  requestAnimationFrame(function(){requestAnimationFrame(function(){',
'    var doc=el.contentDocument;',
'    var isPlaceholder=doc&&doc.body&&doc.body.textContent.indexOf("waiting for first export")>=0;',
'    if(isPlaceholder){',
'      if(pending===el)pending=null;',
'      loading="";',
'      lastSwap=0;',
'      status.textContent="export retrying...";',
'      el.remove();',
'      return;',
'    }',
'    if(pending===el)pending=null;',
'    shown=loading;',
'    var st=statusMap[current]||"";',
'    status.textContent=st==="running"?"\u25CB running":"";',
'    el.className="";',
'    el.style.opacity=1;',
'    el.style.zIndex=1;',
'    if(frame!==el){frame.remove();frame=el;}',
'  })});',
'}',
'function swap(url){',
'  if(pending){pending.remove();pending=null;}',
'  var f=document.createElement("iframe");',
'  f.className="pending";',
'  f.style.cssText="opacity:0;z-index:2";',
'  f.src=url;',
'  f.onload=function(){show(f);};',
'  document.getElementById("main").appendChild(f);',
'  pending=f;',
'}',
'function poll(){',
'  if(!current)return;',
'  fetch("/version?t="+encodeURIComponent(current),{cache:"no-store"}).then(function(r){return r.json()}).then(function(v){',
'    if(v.v!==shown&&v.v!==loading){',
'      var now=Date.now();',
'      if(!pending&&now-lastSwap>=SWAP_MIN_MS){',
'        lastSwap=now;',
'        loading=v.v;',
'        swap("/export?t="+encodeURIComponent(current)+"&v="+encodeURIComponent(v.v));',
'      }',
'    }',
'  }).catch(function(){});',
'}',
'function refreshPicker(){',
'  fetch("/trials",{cache:"no-store"}).then(function(r){return r.json()}).then(function(list){',
'    statusMap={};',
'    list.forEach(function(x){statusMap[x.n]=x.st;});',
'    render(list);',
'  }).catch(function(){});',
'}',
'fetch("/trials",{cache:"no-store"}).then(function(r){return r.json()}).then(function(list){',
'  statusMap={};',
'  list.forEach(function(x){statusMap[x.n]=x.st;});',
'  render(list);',
'  var want=trialFromHash();',
'  var byRecency=list.slice().sort(function(a,b){return b.m-a.m;});',
'  current=(want&&statusMap[want])?want:(byRecency.length?byRecency[0].n:null);',
'  if(current){',
'    location.hash="t="+encodeURIComponent(current);',
'    frame.src="/export?t="+encodeURIComponent(current);',
'    status.textContent=label(statusMap[current]);',
'    Array.prototype.forEach.call(listEl.children,function(el){el.className="t "+(statusMap[el._t]||"")+(el._t===current?" sel":"");});',
'  }',
'  setInterval(function(){refreshPicker();},5000);',
'  setInterval(poll,1000);',
'});',
'</script></body></html>'
].join('\n');

var server = http.createServer(function (req, res) {
  function param(name) {
    var m = req.url.split('?')[1] || '';
    var kv = m.split('&').map(function (p) { return p.split('='); });
    for (var i = 0; i < kv.length; i++) if (kv[i][0] === name) return decodeURIComponent(kv[i][1] || '');
    return null;
  }
  var base = req.url.split('?')[0];

  if (base === '/trials') {
    var tl = listTrials().map(function (n) {
      var s = latestSession(n);
      return { n: n, m: s ? s.t : 0, st: trialStatus(n) };
    });
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(tl));
  } else if (base === '/version') {
    var t = param('t');
    var ok = t && trialHasSessions(t);
    if (!ok) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ v: 'none', ready: false })); return; }
    reexport(t);
    var s = latestSession(t);
    var ready = fs.existsSync(exportPathFor(t));
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ v: keyOf(s), ready: ready }));
  } else if (base === '/export') {
    var t2 = param('t');
    if (t2 && trialHasSessions(t2)) reexport(t2); // no-op if unchanged
    var ep = t2 ? exportPathFor(t2) : null;
    fs.readFile(ep, function (err, data) {
      if (err) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end('<html><body style="background:#111;color:#ddd;font-family:monospace;padding:2em">waiting for first export of ' + (t2 || '?') + '...</body></html>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(data);
    });
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(WRAPPER);
  }
});

// warm up: export the first trial so the initial page has content
var trials0 = listTrials();
if (trials0.length) reexport(trials0[0]);

server.listen(0, '127.0.0.1', function () {
  var url = 'http://127.0.0.1:' + server.address().port + '/';
  console.log('job: ' + jobDir + ' (' + trials0.length + ' pi trials)');
  console.log(url);
  console.log('Ctrl-C to stop');
  var child = spawn('xdg-open', [url], { stdio: 'ignore', detached: true });
  child.on('error', function () { console.log('(xdg-open not found; open ' + url + ' manually)'); });
});
