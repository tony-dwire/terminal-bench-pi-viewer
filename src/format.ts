// Pretty-printing for codemode scripts: they are stored as one long source
// string; format them (they are TypeScript) so they read like code instead of
// a wall of text. Cached and applied at session-load time so rendering stays
// synchronous.

import * as prettier from 'prettier/standalone';
import * as prettierTypescript from 'prettier/plugins/typescript';
import * as prettierEstree from 'prettier/plugins/estree';
import hljs from 'highlight.js/lib/core';
import hljsTs from 'highlight.js/lib/languages/typescript';

hljs.registerLanguage('typescript', hljsTs);

const fmtCache = new Map<string, string>();
export async function formatCode(code: string): Promise<string> {
  const hit = fmtCache.get(code);
  if (hit !== undefined) return hit;
  let out = code;
  const unwrap = (p: unknown) => ((p as { default?: unknown }).default ?? p);
  try {
    out = await prettier.format(code, {
      parser: 'typescript',
      plugins: [unwrap(prettierTypescript), unwrap(prettierEstree)] as never[],
      printWidth: 100,
    });
  } catch { /* not parseable — show it raw */ }
  // highlight AFTER formatting, so the cache holds the final HTML
  out = hljs.highlight(out, { language: 'typescript' }).value;
  fmtCache.set(code, out);
  return out;
}
