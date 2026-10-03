// Job/trial discovery for harbor terminal-bench artifacts.
//
// Layout being read:
//   <job>/<trial>/agent/pi/sessions/*.jsonl   native pi session files
//   <job>/<trial>/result.json                 verifier output (reward drives status)

'use strict';

const fs = require('fs');
const path = require('path');

const sessionsDir = (jobDir, trial) => path.join(jobDir, trial, 'agent', 'pi', 'sessions');

// A trial counts as ours only if it has at least one .jsonl session.
function trialHasSessions(jobDir, name) {
  try {
    return fs.readdirSync(sessionsDir(jobDir, name)).some((f) => f.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

function listTrials(jobDir) {
  let names;
  try {
    names = fs.readdirSync(jobDir).filter((n) => {
      try { return fs.statSync(path.join(jobDir, n)).isDirectory(); } catch { return false; }
    });
  } catch {
    return [];
  }
  return names.filter((n) => trialHasSessions(jobDir, n)).sort();
}

// reward >= 1 -> pass, <= 0 -> fail, other number -> part:<reward>,
// verifier ran but no reward -> err, no result.json yet -> running.
function trialStatus(jobDir, name) {
  try {
    const res = JSON.parse(fs.readFileSync(path.join(jobDir, name, 'result.json'), 'utf8'));
    const reward = res?.verifier_result?.rewards?.reward;
    if (typeof reward === 'number') {
      return reward >= 1 ? 'pass' : reward <= 0 ? 'fail' : `part:${reward}`;
    }
    return 'err';
  } catch {
    return 'running';
  }
}

// Most recently modified session file of a trial: { p, t: mtimeMs, s: size }.
function latestSession(jobDir, trial) {
  let files;
  try {
    files = fs.readdirSync(sessionsDir(jobDir, trial)).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return null;
  }
  const ranked = files.map((f) => {
    const p = path.join(sessionsDir(jobDir, trial), f);
    const st = fs.statSync(p);
    return { p, t: st.mtimeMs, s: st.size };
  }).sort((a, b) => b.t - a.t);
  return ranked[0] ?? null;
}

// Accepts a job dir or a trial dir; a trial is recognized by its sessions
// dir, in which case the job is its parent.
function resolveJobDir(root) {
  return fs.existsSync(path.join(root, 'agent', 'pi', 'sessions'))
    ? path.dirname(root)
    : root;
}

module.exports = { trialHasSessions, listTrials, trialStatus, latestSession, resolveJobDir };
