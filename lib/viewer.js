// Client for the pi-replay live viewer (served at /viewer.js).
//
// Left: trial list with pass/fail/running status, refreshed every 5s.
// Right: an iframe showing pi's HTML export of the selected trial. Live
// refreshes are double-buffered — a new iframe loads off-screen and is only
// swapped in once ready, so the page never flickers or scroll-jumps (the
// scroll position is restored via the injected scroll helper).

'use strict';

const SWAP_MIN_MS = 3000; // don't hot-swap the iframe more often than this

const $ = (id) => document.getElementById(id);
const listEl = $('list');
let frame = $('frame');
const statusEl = $('status');
const countEl = $('count');
const scoreEl = $('score');

let current = null;   // selected trial name
let shown = '';       // version key currently displayed
let loading = '';     // version key being loaded in the pending iframe
let pending = null;   // iframe that is loading a new export
let lastSwap = 0;     // Date.now() of the last swap
const statusMap = {}; // trial name -> status string

const trialFromHash = () => {
  const m = location.hash.match(/t=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
};

const glyph = (st) => (st === 'pass' ? '✓' : st === 'fail' ? '✗' : st === 'running' ? '…' : '⚠');
const label = (st) => (st === 'pass' ? 'pass' : st === 'fail' ? 'fail' : st === 'running' ? 'running' : st === 'err' ? 'error' : st);
// statuses like "part:0.5" collapse to their base word for CSS/matching
const cssClass = (st) => (st || '').split(':')[0];

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    return await res.json();
  } catch {
    return null;
  }
}

function setStatus(name) {
  const st = statusMap[name] || '';
  statusEl.textContent = st === 'running' ? '◌ running' : label(st);
}

function highlight() {
  for (const el of listEl.children) {
    el.className = `t ${cssClass(statusMap[el.dataset.trial] || '')}${el.dataset.trial === current ? ' sel' : ''}`;
  }
}

function render(list) {
  list.sort((a, b) => b.m - a.m);
  countEl.textContent = `(${list.length})`;

  const passes = list.filter((x) => cssClass(x.st) === 'pass').length;
  const scored = list.filter((x) => ['pass', 'fail', 'part'].includes(cssClass(x.st))).length;
  scoreEl.innerHTML = `<b>${passes}</b>/${scored} scored &middot; ${(passes / (scored || 1)).toFixed(2)}`;

  while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
  for (const x of list) {
    const row = document.createElement('div');
    row.className = `t ${cssClass(x.st)}${x.n === current ? ' sel' : ''}`;
    row.dataset.trial = x.n;

    const g = document.createElement('span');
    g.className = 'g';
    g.title = x.st;
    if (x.st === 'running') {
      g.appendChild(Object.assign(document.createElement('span'), { className: 'spin' }));
    } else {
      g.textContent = glyph(x.st);
    }

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = x.n;

    row.append(g, name);
    row.onclick = () => select(x.n);
    listEl.appendChild(row);
  }
  if (current) setStatus(current);
}

function select(name) {
  current = name;
  shown = '';
  loading = '';
  lastSwap = 0;
  if (pending) { pending.remove(); pending = null; }
  location.hash = `t=${encodeURIComponent(name)}`;
  frame.src = `/export?t=${encodeURIComponent(name)}`;
  setStatus(name);
  highlight();
}

function show(el) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const doc = el.contentDocument;
    const isPlaceholder = doc && doc.body && doc.body.textContent.includes('waiting for first export');
    if (isPlaceholder) {
      if (pending === el) pending = null;
      loading = '';
      lastSwap = 0;
      statusEl.textContent = 'export retrying...';
      el.remove();
      return;
    }
    if (pending === el) pending = null;
    shown = loading;
    const st = statusMap[current] || '';
    statusEl.textContent = st === 'running' ? '◌ running' : '';
    el.className = '';
    el.style.opacity = 1;
    el.style.zIndex = 1;
    if (frame !== el) { frame.remove(); frame = el; }
  }));
}

function swap(url) {
  if (pending) { pending.remove(); pending = null; }
  const f = document.createElement('iframe');
  f.className = 'pending';
  f.style.cssText = 'opacity:0;z-index:2';
  f.src = url;
  f.onload = () => show(f);
  $('main').appendChild(f);
  pending = f;
}

async function poll() {
  if (!current) return;
  const v = await fetchJson(`/version?t=${encodeURIComponent(current)}`);
  if (!v || v.v === shown || v.v === loading) return;
  const now = Date.now();
  if (pending || now - lastSwap < SWAP_MIN_MS) return;
  lastSwap = now;
  loading = v.v;
  swap(`/export?t=${encodeURIComponent(current)}&v=${encodeURIComponent(v.v)}`);
}

async function refreshPicker() {
  const list = await fetchJson('/trials');
  if (!list) return;
  for (const x of list) statusMap[x.n] = x.st;
  render(list);
}

(async function init() {
  const list = await fetchJson('/trials');
  if (!list) return;
  for (const x of list) statusMap[x.n] = x.st;
  render(list);

  const want = trialFromHash();
  const byRecency = [...list].sort((a, b) => b.m - a.m);
  current = (want && statusMap[want]) ? want : byRecency[0]?.n ?? null;
  if (current) {
    location.hash = `t=${encodeURIComponent(current)}`;
    frame.src = `/export?t=${encodeURIComponent(current)}`;
    setStatus(current);
    highlight();
  }

  setInterval(refreshPicker, 5000);
  setInterval(poll, 1000);
})();
