#!/usr/bin/env node
// Live viewer server for harbor pi-agent runs.
//
// Accepts a job directory or a single trial directory (siblings are
// discovered either way, so you always get a trial picker).
//
// Routes:
//   /            wrapper page: trial picker + iframe, polls /version each second
//   /viewer.js   client script for the wrapper page
//   /trials      JSON list of trial names that have pi sessions
//   /version?t=  freshness probe per trial: <file>-<mtimeMs>-<size> (re-exports on change)
//   /export?t=   the pi-exported HTML for that trial (scroll helper injected)
//
// Usage: node lib/server.js <job-or-trial-dir>

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { trialHasSessions, listTrials, trialStatus, latestSession, resolveJobDir } = require('./trials');
const Exporter = require('./exporter');

const viewerHtml = fs.readFileSync(path.join(__dirname, 'viewer.html'));
const viewerJs = fs.readFileSync(path.join(__dirname, 'viewer.js'));

// --- helpers -------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const html = (res, body) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Shown in the iframe until the first export lands (the client detects this
// by the "waiting for first export" text and retries).
const placeholder = (trial) => [
  '<html><body style="background:#111;color:#ddd;font-family:monospace;padding:2em">',
  `waiting for first export of ${escapeHtml(trial || '?')}...`,
  '</body></html>',
].join('');

// --- routes --------------------------------------------------------------

async function handle(req, res) {
  const [base, query] = req.url.split('?');
  const param = (name) => new URLSearchParams(query || '').get(name);

  switch (base) {
    case '/': {
      html(res, viewerHtml);
      return;
    }
    case '/viewer.js': {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(viewerJs);
      return;
    }
    case '/trials': {
      const trials = listTrials(jobDir).map((n) => {
        const s = latestSession(jobDir, n);
        return { n, m: s ? s.t : 0, st: trialStatus(jobDir, n) };
      });
      json(res, 200, trials);
      return;
    }
    case '/version': {
      const t = param('t');
      if (!t || !trialHasSessions(jobDir, t)) {
        json(res, 200, { v: 'none', ready: false });
        return;
      }
      await exporter.reexport(t);
      json(res, 200, {
        v: exporter.keyOf(latestSession(jobDir, t)),
        ready: fs.existsSync(exporter.exportPathFor(t)),
      });
      return;
    }
    case '/export': {
      const t = param('t');
      if (t && trialHasSessions(jobDir, t)) {
        await exporter.reexport(t); // no-op if unchanged
        try {
          html(res, await fsp.readFile(exporter.exportPathFor(t)));
          return;
        } catch { /* fall through to placeholder */ }
      }
      html(res, placeholder(t));
      return;
    }
    default: {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  }
}

// --- startup -------------------------------------------------------------

const rootArg = process.argv[2];
if (!rootArg) {
  console.error('usage: pi-replay.js <job-or-trial-dir>');
  process.exit(1);
}
const root = path.resolve(rootArg);
if (!fs.existsSync(root)) {
  console.error('no such directory: ' + root);
  process.exit(1);
}
const jobDir = resolveJobDir(root);
const exporter = new Exporter(jobDir);

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
});

// warm up: export the first trial so the initial page has content
const initialTrials = listTrials(jobDir);
if (initialTrials.length) exporter.reexport(initialTrials[0]);

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`job: ${jobDir} (${initialTrials.length} pi trials)`);
  console.log(url);
  console.log('Ctrl-C to stop');

  const open = { darwin: 'open', win32: 'cmd' }[process.platform] || 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(open, args, { stdio: 'ignore', detached: true }).on('error', () => {
    console.log(`(couldn't open browser; open ${url} manually)`);
  });
});
