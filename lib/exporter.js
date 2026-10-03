// Per-trial HTML export cache, backed by `pi --export`.
//
// The exported HTML for a trial is cached under /tmp until its session file
// changes (versioned by name + mtime + size). Exports are written to a temp
// file and renamed into place so readers never see a partial render, and
// concurrent requests for the same trial share one in-flight export instead
// of shelling out repeatedly.

'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const { latestSession } = require('./trials');

function execFileQuiet(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { stdio: ['ignore', 'ignore', 'ignore'] }, (err) => (err ? reject(err) : resolve()));
  });
}

// Injected into every export: the viewer swaps iframes double-buffered, so
// the scroll position is stashed in sessionStorage and restored on load.
const SCROLL_HELPER = `<script>(function(){var k="pi-replay-view";var p=null;try{p=JSON.parse(sessionStorage.getItem(k))}catch(e){}var h=document.body.scrollHeight;var y=h;if(p&&p.h===h)y=p.y;window.scrollTo(0,y);addEventListener("scroll",function(){try{sessionStorage.setItem(k,JSON.stringify({h:document.body.scrollHeight,y:window.scrollY}))}catch(e){}})})();</script>`;

class Exporter {
  constructor(jobDir) {
    this.jobDir = jobDir;
    const hash = crypto.createHash('md5').update(jobDir).digest('hex').slice(0, 12);
    this.workRoot = path.join(os.tmpdir(), 'pi-replay-' + hash);
    this.lastKey = new Map();   // trial -> version key of the cached export
    this.inFlight = new Map();  // trial -> export promise currently running
  }

  exportPathFor(trial) {
    return path.join(this.workRoot, trial + '.html');
  }

  // Version key of a session: <file>-<mtimeMs>-<size>.
  keyOf(session) {
    return session ? `${path.basename(session.p)}-${session.t}-${session.s}` : null;
  }

  // Export if (and only if) the session changed. Safe to call concurrently
  // and on every poll; no-ops when nothing changed.
  async reexport(trial) {
    if (this.inFlight.has(trial)) return this.inFlight.get(trial);

    const session = latestSession(this.jobDir, trial);
    if (!session) return;
    const key = this.keyOf(session);
    if (key === this.lastKey.get(trial)) return;

    const promise = this.#export(trial, session, key)
      .finally(() => this.inFlight.delete(trial));
    this.inFlight.set(trial, promise);
    return promise;
  }

  async #export(trial, session, key) {
    const tmp = this.exportPathFor(trial) + '.tmp';
    const staged = this.exportPathFor(trial) + '.tmp2';
    try {
      await fsp.mkdir(this.workRoot, { recursive: true });
      await execFileQuiet('pi', ['--export', session.p, tmp]);
      let html = await fsp.readFile(tmp, 'utf8');
      html = html.replace('</body>', SCROLL_HELPER + '</body>');
      await fsp.writeFile(staged, html);
      await fsp.unlink(tmp);
      await fsp.rename(staged, this.exportPathFor(trial));
      this.lastKey.set(trial, key);
    } catch (err) {
      console.error(`export failed for ${trial}: ${err.message}`);
      this.lastKey.delete(trial); // allow retry on the next poll
    }
  }
}

module.exports = Exporter;
