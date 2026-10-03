// App shell: trial selection, sidebar/session refresh intervals, and the
// per-trial freshness poll that re-fetches the session when its file changes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from './Sidebar';
import { MessageList } from './MessageList';
import { formatCode } from './format';
import { latestContext, parseSession } from './helpers';
import type { SessionEntry, TextBlock, TrialInfo } from './types';

const SWAP_MIN_MS = 3000;      // don't re-fetch the session more often than this
const TRIALS_MS = 5000;        // sidebar refresh interval
const VERSION_MS = 1000;       // per-trial freshness poll

export function App() {
  const atBottomRef = useRef(true); // user is reading the tail of the transcript
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
      const parsed = parseSession(await res.text());
      // pretty-print codemode scripts before they hit the screen
      const codes: string[] = [];
      for (const e of parsed) {
        const content = e.type === 'message' && Array.isArray(e.message?.content) ? e.message!.content : [];
        for (const c of content) {
          if (c.type === 'toolCall' && c.name === 'codemode' && typeof c.arguments?.code === 'string') {
            codes.push(c.arguments.code);
          }
        }
      }
      const formatted = await Promise.all(codes.map((c) => formatCode(c)));
      let i = 0;
      for (const e of parsed) {
        const content = e.type === 'message' && Array.isArray(e.message?.content) ? e.message!.content : [];
        for (const c of content) {
          if (c.type === 'toolCall' && c.name === 'codemode' && typeof c.arguments?.code === 'string') {
            c.arguments.code = formatted[i++];
          }
        }
      }
      setEntries(parsed);
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

  // track whether the user is reading the tail of the transcript
  useEffect(() => {
    const c = document.getElementById('main');
    if (!c) return;
    const onScroll = () => {
      atBottomRef.current = c.scrollTop + c.clientHeight >= c.scrollHeight - 24;
    };
    onScroll();
    c.addEventListener('scroll', onScroll, { passive: true });
    return () => c.removeEventListener('scroll', onScroll);
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
      <Sidebar trials={trials} current={current} onSelect={select} note={note} contextTokens={latestContext(entries)} />
      <main id="main">
        {entries.length
          ? <MessageList entries={entries} atBottomRef={atBottomRef} />
          : <div id="empty">no session loaded yet…</div>}
      </main>
    </>
  );
}
