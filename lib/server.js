#!/usr/bin/env node
// Live viewer server for harbor pi-agent runs.
//
// Accepts a job directory or a single trial directory (siblings are
// discovered either way, so you always get a trial picker).
//
// Routes:
//   /             wrapper page: trial picker + session view (React app)
//   /viewer.app.js  bundled React client (built from src/ with esbuild)
//   /trials       JSON list of trial names that have pi sessions
//   /version?t=   freshness probe per trial: <file>-<mtimeMs>-<size>
//   /session?t=   raw pi session JSONL for that trial
//
// Rendering happens entirely client-side; this server only serves files.
//
// Usage: node lib/server.js <job-or-trial-dir>

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const { trialHasSessions, listTrials, trialStatus, latestSession, resolveJobDir } = require('./trials');

const viewerHtml = fs.readFileSync(path.join(__dirname, 'viewer.html'));
const viewerApp = fs.existsSync(path.join(__dirname, 'viewer.app.js'))
  ? fs.readFileSync(path.join(__dirname, 'viewer.app.js'))
  : null;

// --- helpers -------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const html = (res, body) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
};

// --- routes --------------------------------------------------------------

async function handle(req, res, jobDir) {
  const [base, query] = req.url.split('?');
  const param = (name) => new URLSearchParams(query || '').get(name);

  switch (base) {
    case '/': {
      html(res, viewerHtml);
      return;
    }
    case '/viewer.app.js': {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      res.end(viewerApp ?? 'console.error("lib/viewer.app.js missing — run: npm run build");');
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
      const s = t && trialHasSessions(jobDir, t) ? latestSession(jobDir, t) : null;
      json(res, 200, { v: s ? `${path.basename(s.p)}-${s.t}-${s.s}` : 'none' });
      return;
    }
    case '/favicon.ico': {
      res.writeHead(204);
      res.end();
      return;
    }
    case '/favicon.ico': {
      res.writeHead(204);
      res.end();
      return;
    }
    case '/session': {
      const t = param('t');
      if (!t || !trialHasSessions(jobDir, t)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('no such trial');
        return;
      }
      const s = latestSession(jobDir, t);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(await fsp.readFile(s.p, 'utf8'));
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
if (!viewerApp) {
  console.error('lib/viewer.app.js not found — build it first with: npm run build');
}
const jobDir = resolveJobDir(root);

const server = http.createServer((req, res) => {
  handle(req, res, jobDir).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: err.message });
    else res.end();
  });
});

server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`job: ${jobDir} (${listTrials(jobDir).length} pi trials)`);
  console.log(url);
  console.log('Ctrl-C to stop');

  const open = { darwin: 'open', win32: 'cmd' }[process.platform] || 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(open, args, { stdio: 'ignore', detached: true }).on('error', () => {
    console.log(`(couldn't open browser; open ${url} manually)`);
  });
});
