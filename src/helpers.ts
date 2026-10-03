// Shared formatting and status helpers.

import { marked } from './vendor/marked';
import type { SessionEntry } from './types';

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};
export const escapeHtml = (s: string): string => String(s).replace(/[&<>"']/g, (c) => ESCAPE_MAP[c] ?? c);

// Render markdown safely: escape raw HTML first so nothing in a session
// (which may contain prompt-injected content) can inject markup.
export function md(text: string): { __html: string } {
  return { __html: marked.parse(escapeHtml(text)) };
}

// Compact token count for display: 8250 -> "8.3k", 1234567 -> "1.2M".
export function fmtTokens(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

// Context usage of the most recent assistant message: the model's
// usage.totalTokens after its last turn (undefined if the session has none).
export function latestContext(entries: SessionEntry[]): number | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === 'message' && e.message?.role === 'assistant' && e.message.usage?.totalTokens) {
      return e.message.usage.totalTokens;
    }
  }
  return undefined;
}

export function statusGlyph(st: string): string {
  if (st === 'pass') return '✓';
  if (st === 'fail') return '✗';
  if (st === 'running') return '…';
  return '⚠';
}

export function statusLabel(st: string): string {
  if (st === 'pass') return 'pass';
  if (st === 'fail') return 'fail';
  if (st === 'running') return 'running';
  if (st === 'err') return 'error';
  return st;
}

export function ts(iso?: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return '';
  }
}

export function parseSession(text: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line) as SessionEntry); } catch { /* skip malformed line */ }
  }
  return entries;
}
