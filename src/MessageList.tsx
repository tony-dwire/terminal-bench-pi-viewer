// Transcript rendering: user/assistant messages plus compaction markers,
// with tool results matched back to their calls by id.

import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Thinking } from './Collapsible';
import { ToolCall } from './ToolCall';
import { md, ts } from './helpers';
import type { SessionEntry, TextBlock, ThinkingBlock, ToolCallBlock, ToolResultEntry } from './types';

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

export function MessageList({ entries, atBottomRef }: { entries: SessionEntry[]; atBottomRef: MutableRefObject<boolean> }) {
  const listRef = useRef<HTMLDivElement>(null);
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
  // keep the bottom of the transcript in view as new results stream in —
  // but only while the user is already reading the tail
  useEffect(() => {
    const list = listRef.current;
    const container = list?.closest('#main');
    if (!list || !container) return;
    const c = container as HTMLElement;
    const last = list.lastElementChild as HTMLElement | null;
    if (!last) return;
    const delta = last.getBoundingClientRect().bottom - c.getBoundingClientRect().bottom;
    if (atBottomRef.current) {
      c.scrollTop += delta;
    }
  }, [entries, atBottomRef]);

  return <div id="messages" ref={listRef}>{visible}</div>;
}
