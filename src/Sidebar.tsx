// Trial list with pass/fail/running status and the running score.

import { fmtTokens, statusGlyph, statusLabel } from './helpers';
import type { TrialInfo } from './types';

export function Sidebar({ trials, current, onSelect, note, contextTokens }: {
  trials: TrialInfo[];
  current: string | null;
  onSelect: (name: string) => void;
  note: string;
  contextTokens?: number;
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
      <footer id="status">
        {note || (sel ? statusLabel(sel.st) : '')}
        {contextTokens ? <span className="ctx"> · ctx {fmtTokens(contextTokens)}</span> : null}
      </footer>
    </aside>
  );
}
