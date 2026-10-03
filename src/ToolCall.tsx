// Compact one-line tool call headers with collapsible output blocks.

import type { ReactNode } from 'react';
import { CODE_PREVIEW_LINES, Collapsible } from './Collapsible';
import { escapeHtml } from './helpers';
import type { NestedCall, TextBlock, ToolCallBlock, ToolResultEntry } from './types';

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
      preview={3}
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

export function ToolCall({ call, result }: { call: ToolCallBlock; result?: ToolResultEntry }) {
  const args = call.arguments || {};
  const name = call.name;
  const isError = result?.message.isError || false;
  const output = resultText(result);
  const errClass = isError ? ' error' : '';

  let header: ReactNode;
  let body: ReactNode = null;

  if (name === 'bash') {
    header = <div className="tool-command">$ {String(args.command ?? '...')}</div>;
    if (output) body = <Collapsible text={output} preview={5} className={`tool-output${errClass}`} />;
  } else if (name === 'codemode') {
    header = <div className="tool-header"><span className="tool-name">codemode</span></div>;
    if (typeof args.code === 'string') {
      body = (
        <>
          <Collapsible
            text={String(args.code)}
            html
            preview={CODE_PREVIEW_LINES}
            className="tool-output code-arg"
          />
          {output ? <Collapsible text={output} preview={10} className={`tool-output${errClass}`} /> : null}
          {result?.message.nestedCalls?.calls?.length ? (
            <NestedCalls nested={result.message.nestedCalls} />
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
