// pi-replay viewer: fetches raw pi session JSONL and renders it client-side.
//
// Left: trial list with pass/fail/running status, refreshed every 5s.
// Right: the selected trial's session, re-fetched whenever its session file
// changes (polled via /version). Messages are rendered with marked; tool
// calls get compact one-line headers and collapsible output blocks.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { marked } from './vendor/marked';

const SWAP_MIN_MS = 3000;      // don't re-fetch the session more often than this
const TRIALS_MS = 5000;        // sidebar refresh interval
const VERSION_MS = 1000;       // per-trial freshness poll

// --- session shape (subset we render) -------------------------------------

interface TextBlock { type: 'text'; text: string }
interface ThinkingBlock { type: 'thinking'; thinking: string }
interface ToolCallBlock { type: 'toolCall'; id: string; name: string; arguments?: Record<string, unknown> }
type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

interface SessionMessage {
  role: 'user' | 'assistant' | 'toolResult' | string;
  content: ContentBlock[] | string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: {
    diff?: string;
    nestedCalls?: { calls: NestedCall[]; complete?: boolean };
  };
}

interface SessionEntry {
  type: string;
  id?: string;
  timestamp?: string;
  message?: SessionMessage;
  tokensBefore?: number;
}

interface ToolResultEntry extends SessionEntry {
  message: SessionMessage & { role: 'toolResult'; toolCallId: string };
}

interface TrialInfo {
  n: string;  // trial name
  m: number;  // session mtime
  st: string; // pass | fail | running | err | part:<reward>
}

interface NestedCall {
  name: string;
  status?: 'ok' | 'error' | 'unfinished';
  arguments?: unknown;
  argumentsBytes?: number;
  durationMs?: number;
  error?: string;
}

// --- helpers --------------------------------------------------------------

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);

// Render markdown safely: escape raw HTML first so nothing in a session
// (which may contain prompt-injected content) can inject markup.
function md(text: string): { __html: string } {
  return { __html: marked.parse(escapeHtml(text)) };
}

function statusGlyph(st: string): string {
  if (st === 'pass') return '✓';
  if (st === 'fail') return '✗';
  if (st === 'running') return '…';
  return '⚠';
}

function statusLabel(st: string): string {
  if (st === 'pass') return 'pass';
  if (st === 'fail') return 'fail';
  if (st === 'running') return 'running';
  if (st === 'err') return 'error';
  return st;
}

function ts(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return '';
  }
}

function asText(block: ContentBlock | undefined): string | null {
  return block && block.type === 'text' ? block.text : null;
}

// ---------------------------------------------------------------- sidebar

function Sidebar({ trials, current, onSelect, note }: {
  trials: TrialInfo[];
  current: string | null;
  onSelect: (name: string) => void;
  note: string;
}) {
  const scored = trials.filter((t) => ['pass', 'fail', 'part'].includes(t.st));
  const passed = trials.filter((t) => t.st === 'pass').length;
  const ratio = scored.length ? passed / scored.length : 0;
  const sel = trials.find((t) => t.n === current);
  return (
    <aside id="side">
      <h1>trials <span>({trials.length})</span></h1>
      <div id="score"><b>{passed}</b>/{scored.length} scored &middot; {ratio.toFixed(2)}</div>
      <nav id="list">
        {trials.map((t) => (
          <div key={t.n} className={`t ${t.st}${t.n === current ? ' sel' : ''}`} onClick={() => onSelect(t.n)}>
            <span className="g" title={t.st}>
              {t.st === 'running' ? <span className="spin" /> : statusGlyph(t.st)}
            </span>
            <span className="name">{t.n}</span>
          </div>
        ))}
      </nav>
      <footer id="status">{note || (sel ? statusLabel(sel.st) : '')}</footer>
    </aside>
  );
}

// ------------------------------------------------------------------ tools

const THINKING_LINES = 12; // how much thinking to show before truncating

// Thinking is shown partially expanded by default: a fixed number of lines
// with a fade-out, click anywhere to toggle the rest.
function Thinking({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const truncated = !expanded && lines.length > THINKING_LINES;
  const toggle = () => setExpanded(!expanded);
  if (lines.length <= THINKING_LINES) {
    return (
      <div className="thinking-block" onClick={toggle}>
        <div className="thinking-text">{text}</div>
      </div>
    );
  }
  return (
    <div className={`thinking-block${truncated ? ' truncated' : ''}`} onClick={toggle}>
      <div className="thinking-text">
        {truncated ? lines.slice(0, THINKING_LINES).join('\n') : text}
      </div>
      <div className="thinking-toggle">
        {expanded ? 'show less' : `show ${lines.length - THINKING_LINES} more lines`}
      </div>
    </div>
  );
}

function Collapsible({ text, preview = 10, className = 'tool-output' }: {
  text: string;
  preview?: number;
  className?: string;
}) {
  const lines = text.split('\n');
  if (lines.length <= preview) {
    return <div className={className}><pre>{text}</pre></div>;
  }
  return (
    <details className={`${className} expandable`}>
      <summary>{lines.length} lines — click to expand</summary>
      <pre>{text}</pre>
    </details>
  );
}

function resultText(result: ToolResultEntry | undefined): string {
  if (!result) return '';
  const content = Array.isArray(result.message.content) ? result.message.content : [];
  return content.filter((c): c is TextBlock => c.type === 'text').map((c) => c.text).join('\n');
}

function NestedCalls({ nested }: { nested: { calls: NestedCall[]; complete?: boolean } }) {
  const icons: Record<string, string> = { ok: '✓', error: '✗', unfinished: '…' };
  return (
    <Collapsible
      className="tool-output nested"
      preview={1}
      text={[
        `nested calls: ${nested.calls.length}${nested.complete === false ? ' (incomplete)' : ''}`,
        ...nested.calls.map((c) =>
          `${icons[c.status ?? ''] || '?'} ${c.name} ${
            c.arguments !== undefined ? JSON.stringify(c.arguments)
            : c.argumentsBytes !== undefined ? `[arguments omitted, ${c.argumentsBytes} bytes]` : ''
          }${c.durationMs !== undefined ? ' ' + c.durationMs + 'ms' : ''}${c.error ? ' — ' + c.error : ''}`),
      ].join('\n')}
    />
  );
}

function ToolCall({ call, result }: { call: ToolCallBlock; result?: ToolResultEntry }) {
  const args = call.arguments || {};
  const name = call.name;
  const isError = result?.message.isError || false;
  const output = resultText(result);
  const errClass = isError ? ' error' : '';

  let header: React.ReactNode;
  let body: React.ReactNode = null;

  if (name === 'bash') {
    header = <div className="tool-command">$ {String(args.command ?? '...')}</div>;
    if (output) body = <Collapsible text={output} preview={5} className={`tool-output${errClass}`} />;
  } else if (name === 'codemode') {
    header = <div className="tool-header"><span className="tool-name">codemode</span></div>;
    if (typeof args.code === 'string') {
      body = (
        <>
          <div className="tool-output code-arg"><pre>{args.code}</pre></div>
          {result?.message.details?.nestedCalls?.calls?.length ? (
            <NestedCalls nested={result.message.details.nestedCalls} />
          ) : null}
        </>
      );
    } else {
      body = <div className="tool-output"><pre>{JSON.stringify(args, null, 2)}</pre></div>;
    }
  } else if (name === 'read' || name === 'write' || name === 'edit' || name === 'ls') {
    const p = String(args.file_path ?? args.path ?? '');
    let range = '';
    if (name === 'read' && (args.offset !== undefined || args.limit !== undefined)) {
      const start = Number(args.offset ?? 1);
      range = `:${start}${args.limit !== undefined ? '-' + (start + Number(args.limit) - 1) : ''}`;
    }
    let lineNote = '';
    if (name === 'write' && typeof args.content === 'string') {
      const n = args.content.split('\n').length;
      if (n > 10) lineNote = ` (${n} lines)`;
    }
    header = (
      <div className="tool-header">
        <span className="tool-name">{name}</span> <span className="tool-path">{p}{range}</span>
        {lineNote && <span className="line-count">{lineNote}</span>}
      </div>
    );
    if (name === 'write' && typeof args.content === 'string') {
      body = <Collapsible text={args.content} preview={10} />;
    } else if (name === 'edit' && typeof result?.message.details?.diff === 'string') {
      const diff = result.message.details.diff;
      body = (
        <div className="tool-diff">
          {diff.split('\n').map((l, i) => (
            <div key={i} className={l.startsWith('+') ? 'diff-added' : l.startsWith('-') ? 'diff-removed' : 'diff-context'}>{l}</div>
          ))}
        </div>
      );
    } else if (output) {
      body = <Collapsible text={output} preview={10} className={`tool-output${errClass}`} />;
    }
  } else {
    header = <div className="tool-header"><span className="tool-name">{escapeHtml(name)}</span></div>;
    body = <Collapsible text={JSON.stringify(args, null, 2)} preview={10} />;
    if (output) body = <>{body}<Collapsible text={output} preview={10} className={`tool-output${errClass}`} /></>;
  }

  return (
    <div className={`tool-execution ${result ? (isError ? 'error' : 'success') : 'pending'}`}>
      {header}
      {body}
    </div>
  );
}

// --------------------------------------------------------------- messages

function Message({ entry, results }: { entry: SessionEntry; results: Map<string, ToolResultEntry> }) {
  const msg = entry.message!;

  if (msg.role === 'user') {
    const content = Array.isArray(msg.content) ? msg.content : [];
    const text = content.filter((c): c is TextBlock => c.type === 'text').map((c) => c.text).join('\n');
    if (!text.trim()) return null;
    return (
      <div className="user-message">
        <div className="msg-ts">{ts(entry.timestamp)}</div>
        <div className="msg-body markdown-content" dangerouslySetInnerHTML={md(text)} />
      </div>
    );
  }

  if (msg.role === 'assistant') {
    const content = Array.isArray(msg.content) ? msg.content : [];
    return (
      <div className="assistant-message">
        <div className="msg-ts">{ts(entry.timestamp)}</div>
        {content.filter((c) => c.type === 'text' && c.text.trim()).map((c, i) => (
          <div key={i} className="msg-body markdown-content" dangerouslySetInnerHTML={md((c as TextBlock).text)} />
        ))}
        {content.filter((c) => c.type === 'thinking' && (c as ThinkingBlock).thinking.trim()).map((c, i) => (
          <Thinking key={i} text={(c as ThinkingBlock).thinking} />
        ))}
        {content.filter((c) => c.type === 'toolCall').map((c) => (
          <ToolCall key={(c as ToolCallBlock).id} call={c as ToolCallBlock} result={results.get((c as ToolCallBlock).id)} />
        ))}
      </div>
    );
  }

  return null;
}

function parseSession(text: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line) as SessionEntry); } catch { /* skip malformed line */ }
  }
  return entries;
}

function MessageList({ entries }: { entries: SessionEntry[] }) {
  const results = new Map<string, ToolResultEntry>();
  for (const e of entries) {
    if (e.type === 'message' && e.message?.role === 'toolResult' && e.message.toolCallId) {
      results.set(e.message.toolCallId, e as ToolResultEntry);
    }
  }

  const visible: React.ReactNode[] = [];
  for (const e of entries) {
    if (e.type === 'message') {
      if (e.message && (e.message.role === 'user' || e.message.role === 'assistant')) {
        visible.push(<Message key={e.id} entry={e} results={results} />);
      }
    } else if (e.type === 'compaction' || e.type === 'auto_compaction') {
      visible.push(
        <div key={e.id} className="compaction">
          <span className="compaction-label">[compaction]</span> compacted from {(e.tokensBefore ?? 0).toLocaleString()} tokens
        </div>
      );
    }
  }
  return <div id="messages">{visible}</div>;
}

// -------------------------------------------------------------------- app

function App() {
  const [trials, setTrials] = useState<TrialInfo[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [note, setNote] = useState('');
  const shownVersion = useRef('');
  const loadingVersion = useRef('');
  const lastSwap = useRef(0);
  const currentRef = useRef<string | null>(null);
  currentRef.current = current;

  const loadSession = useCallback(async (trial: string) => {
    try {
      const res = await fetch(`/session?t=${encodeURIComponent(trial)}`, { cache: 'no-store' });
      setEntries(parseSession(await res.text()));
    } catch { /* keep old entries */ }
  }, []);

  const select = useCallback((name: string) => {
    setCurrent(name);
    location.hash = `t=${encodeURIComponent(name)}`;
    shownVersion.current = '';
    loadingVersion.current = '';
    lastSwap.current = 0;
    setEntries([]);
    setNote('');
    loadSession(name);
  }, [loadSession]);

  // initial load: pick trial from hash or the most recent one
  useEffect(() => {
    void (async () => {
      try {
        const list: TrialInfo[] = await (await fetch('/trials', { cache: 'no-store' })).json();
        setTrials(list);
        const want = (location.hash.match(/t=([^&]+)/) || [])[1];
        const name = want && list.some((t) => t.n === decodeURIComponent(want))
          ? decodeURIComponent(want)
          : list.slice().sort((a, b) => b.m - a.m)[0]?.n;
        if (name) select(name);
      } catch { /* server unreachable */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // sidebar refresh
  useEffect(() => {
    const iv = setInterval(() => void (async () => {
      try {
        const list: TrialInfo[] = await (await fetch('/trials', { cache: 'no-store' })).json();
        setTrials(list);
        if (currentRef.current && !list.some((t) => t.n === currentRef.current)) {
          const latest = list.slice().sort((a, b) => b.m - a.m)[0];
          if (latest) select(latest.n);
        }
      } catch { /* ignore */ }
    })(), TRIALS_MS);
    return () => clearInterval(iv);
  }, [select]);

  // per-trial freshness poll -> re-fetch session on change
  useEffect(() => {
    if (!current) return;
    const iv = setInterval(() => void (async () => {
      try {
        const v = await (await fetch(`/version?t=${encodeURIComponent(current)}`, { cache: 'no-store' })).json();
        if (v.v !== shownVersion.current && v.v !== loadingVersion.current) {
          const now = Date.now();
          if (now - lastSwap.current < SWAP_MIN_MS) return;
          lastSwap.current = now;
          loadingVersion.current = v.v;
          await loadSession(current);
          shownVersion.current = v.v;
          loadingVersion.current = '';
        }
      } catch { /* ignore */ }
    })(), VERSION_MS);
    return () => clearInterval(iv);
  }, [current, loadSession]);

  return (
    <>
      <Sidebar trials={trials} current={current} onSelect={select} note={note} />
      <main id="main">
        {entries.length
          ? <MessageList entries={entries} />
          : <div id="empty">no session loaded yet…</div>}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
