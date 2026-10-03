# pi-replay

Replay and watch [pi](https://github.com/badlogic/pi-mono) coding-agent runs from
[terminal-bench](https://github.com/laude-institute/terminal-bench) (harbor) job artifacts —
in your terminal, or live in the browser with a trial sidebar.

## Why

When you launch a batch of terminal-bench trials backed by the pi agent, each trial writes
its native pi session files under `<job>/<trial>/agent/pi/sessions/*.jsonl`. This tool
turns those back into something you can actually read:

- **Terminal replay** of a finished trial (assistant / user / tool calls / results)
- **`--live`** follows a running trial like an asciinema play
- **`--html`** serves a live viewer: a React app that fetches the raw session JSONL and
  renders it client-side, with a scrollable sidebar of all trials in the job,
  pass/fail/running status, a spinner for in-progress trials, and a running success score

## Install

No dependencies beyond the runtime tools:

- bash, jq (terminal modes)
- node ≥ 16 (html mode; no npm install needed — the client bundle is committed)

```sh
git clone https://github.com/tony-dwire/terminal-bench-pi-viewer.git
cd terminal-bench-pi-viewer
export PATH="$PWD/bin:$PATH"
```

## Usage

```sh
# render a finished trial in the terminal
pi-replay jobs/2026-09-30__20-55-19/build-cython-ext__USv7taD

# follow a running trial
pi-replay jobs/2026-09-30__20-55-19/build-cython-ext__USv7taD --live

# live HTML viewer for a whole job (or a single trial — the job is discovered)
pi-replay jobs/2026-09-30__20-55-19 --html
```

`--html` prints a `http://127.0.0.1:<port>/` URL, opens your browser, and serves until
Ctrl-C. The page polls each second and re-renders when the session file changes, so you can
watch the agent work in real time.

![pi-replay live viewer showing the trial sidebar with pass/fail/running statuses, a score line, and a rendered session with markdown and highlighted codemode scripts](docs/screenshot.png)

### The HTML viewer

- **Sidebar** lists every trial in the job that has pi sessions, most recent first, with
  status icons: ✓ pass · ✗ fail · ⚠ error/cancelled · spinner while running
- **Score line** under the header: passes / scored trials, truncated to two digits (e.g. `3/5 scored · 0.60`)
- **Main pane** renders the selected session:
  - user messages and assistant markdown, rendered with
    [marked](https://github.com/markedjs/marked) after escaping (session content can never
    inject markup)
  - thinking blocks that open with a bounded preview — click to expand the rest
  - tool calls with compact headers, syntax-highlighted diffs, and collapsible output
  - **codemode** calls pretty-printed with [prettier](https://prettier.io) and syntax
    highlighted with [highlight.js](https://highlightjs.org), with their output and the
    nested tool calls they made (arguments, durations, errors) below the script
  - every long block (script, output, thinking, nested calls) opens with a preview plus a
    fade and a click-to-expand toggle
- The transcript stays pinned to the newest message as results stream in; scrolling up to
  read pauses the pinning until you return to the tail
- The session is re-fetched automatically when the session file changes, so you can watch
  the agent work in real time
- Selected trial is tracked in the URL hash, so a reload (or a bookmark) resumes where you were

## How it works

`--html` mode runs a small zero-dependency node server (`lib/server.js`):

| route           | purpose                                                        |
|-----------------|----------------------------------------------------------------|
| `/`             | wrapper page (`lib/viewer.html`)                                |
| `/viewer.app.js`| bundled React client (built from `src/app.tsx` with esbuild)    |
| `/trials`       | JSON list of trials with pi sessions, with verifier-derived status |
| `/version?t=`   | freshness probe per trial (mtime + size)                        |
| `/session?t=`   | raw pi session JSONL for that trial                             |

Status comes from each trial's `result.json` (`verifier_result.rewards.reward`):
reward ≥ 1.0 → pass, ≤ 0.0 → fail, no verifier result → error, no result yet → running.

### Building the client

The bundled client is committed (`lib/viewer.app.js`), so html mode needs no npm install.
To rebuild it after changing `src/`:

```sh
npm run build
```

## License

MIT — see [LICENSE](LICENSE).
