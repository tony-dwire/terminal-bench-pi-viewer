// Truncatable text blocks: a fixed number of lines shown by default with a
// fade-out, click anywhere to toggle the rest. Thinking is shown partially
// expanded by default; long tool output collapses further.

import { useState } from 'react';

const THINKING_LINES = 12;     // thinking lines shown before truncating
export const CODE_PREVIEW_LINES = 15; // codemode script lines shown before truncating

// Thinking is shown partially expanded by default: a fixed number of lines
// with a fade-out, click anywhere to toggle the rest.
export function Thinking({ text }: { text: string }) {
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

// Long blocks open partially expanded by default: a fixed number of lines
// with a fade-out, click to toggle the rest (same pattern as thinking).
export function Collapsible({ text, preview = 10, className = 'tool-output', html = false }: {
  text: string;
  preview?: number;
  className?: string;
  html?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const truncated = !expanded && lines.length > preview;
  const toggle = () => setExpanded(!expanded);
  const shown = truncated ? lines.slice(0, preview).join('\n') : text;
  const cls = `${className}${truncated ? ' truncated' : ''}`;
  const body = html
    ? <pre dangerouslySetInnerHTML={{ __html: shown }} />
    : <pre>{shown}</pre>;
  if (!truncated && lines.length <= preview) {
    return <div className={className}>{body}</div>;
  }
  return (
    <div className={cls} onClick={toggle}>
      {body}
      <div className="thinking-toggle">
        {expanded ? 'show less' : `show ${lines.length - preview} more lines`}
      </div>
    </div>
  );
}
