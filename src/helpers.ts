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
