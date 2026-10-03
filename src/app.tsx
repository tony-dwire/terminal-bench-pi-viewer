// pi-replay viewer: fetches raw pi session JSONL and renders it client-side.
//
// Left: trial list with pass/fail/running status, refreshed every 5s.
// Right: the selected trial's session, re-fetched whenever its session file
// changes (polled via /version). Messages are rendered with marked; tool
// calls get compact one-line headers and collapsible output blocks.
//
// Split across: types.ts, helpers.ts, format.ts, Sidebar.tsx, Collapsible.tsx,
// ToolCall.tsx, MessageList.tsx, App.tsx — this file is just the entry point.

import { createRoot } from 'react-dom/client';
import { App } from './viewer';

createRoot(document.getElementById('root')!).render(<App />);
