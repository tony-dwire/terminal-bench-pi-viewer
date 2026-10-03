// Session JSONL shape (subset we render).

export interface TextBlock { type: 'text'; text: string }
export interface ThinkingBlock { type: 'thinking'; thinking: string }
export interface ToolCallBlock { type: 'toolCall'; id: string; name: string; arguments?: Record<string, unknown> }
export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

// Token accounting pi records on assistant messages (subset we render).
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'toolResult' | string;
  usage?: TokenUsage;
  content: ContentBlock[] | string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  details?: {
    diff?: string;
  };
  // calls this tool made through ctx.executeTool() (e.g. from a codemode script);
  // recorded with name/args/duration/error but without their results
  nestedCalls?: { calls: NestedCall[]; complete?: boolean };
}

export interface SessionEntry {
  type: string;
  id?: string;
  timestamp?: string;
  message?: SessionMessage;
  tokensBefore?: number;
}

export interface ToolResultEntry extends SessionEntry {
  message: SessionMessage & { role: 'toolResult'; toolCallId: string };
}

export interface TrialInfo {
  n: string;  // trial name
  m: number;  // session mtime
  st: string; // pass | fail | running | err | part:<reward>
}

export interface NestedCall {
  name: string;
  status?: 'ok' | 'error' | 'unfinished';
  arguments?: unknown;
  argumentsBytes?: number;
  durationMs?: number;
  error?: string;
}
