/**
 * Small product contracts shared by route components.
 *
 * These values are kept outside React so the endpoint and navigation choices
 * can be tested directly. The MCP names are not repeated here: the server's
 * live tools/list response remains the source of truth.
 */

export const PUBLIC_WORKSPACE_PATH = '/explore/dash' as const;

/**
 * Commands exposed by the shipped CLI.
 *
 * The regression suite compares this browser-safe copy with src/cli/args.ts,
 * which remains the parser's source of truth.
 */
export const CLI_COMMAND_NAMES = [
  'doctor',
  'status',
  'profile',
  'shell',
  'ask',
  'read',
  'explain',
  'timeline',
  'bench',
] as const;

export function askEndpoint(demo: boolean): '/api/explore/ask' | '/api/ask' {
  return demo ? '/api/explore/ask' : '/api/ask';
}

export type VoiceDockKeyboardAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'collapse' }
  | { readonly kind: 'focus'; readonly index: number };

/**
 * The dialog owns Escape and Tab only. Collapsing never implies cancelling a
 * pending operation; that authority remains behind the explicit CANCEL control.
 */
export function voiceDockKeyboardAction(
  key: string,
  shiftKey: boolean,
  activeIndex: number,
  focusableCount: number,
): VoiceDockKeyboardAction {
  if (key === 'Escape') return { kind: 'collapse' };
  if (key !== 'Tab' || focusableCount < 1) return { kind: 'none' };
  const direction = shiftKey ? -1 : 1;
  const from = activeIndex >= 0 && activeIndex < focusableCount
    ? activeIndex
    : shiftKey ? 0 : -1;
  return {
    kind: 'focus',
    index: (from + direction + focusableCount) % focusableCount,
  };
}

const VOICE_DOCK_TEXT_LIMIT = 640;
const VOICE_DOCK_COUNT_LIMIT = 9_999;

/** Compact dock copy is bounded even if a malformed browser response is not. */
export function voiceDockText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (text === '') return null;
  if (text.length <= VOICE_DOCK_TEXT_LIMIT) return text;
  return `${text.slice(0, VOICE_DOCK_TEXT_LIMIT - 1)}…`;
}

/** Counts stay exact up to the dock's visual limit and declare truncation above it. */
export function voiceDockCount(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return '0';
  return value > VOICE_DOCK_COUNT_LIMIT ? '9,999+' : value.toLocaleString('en-GB');
}

export const MCP_TOOLS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
} as const;

/** Read ordered tool names from a tools/list reply and ignore malformed rows. */
export function mcpToolNames(reply: unknown): readonly string[] {
  if (typeof reply !== 'object' || reply === null) return [];
  const result = Reflect.get(reply, 'result');
  if (typeof result !== 'object' || result === null) return [];
  const tools = Reflect.get(result, 'tools');
  if (!Array.isArray(tools)) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null) continue;
    const name = Reflect.get(tool, 'name');
    if (typeof name !== 'string' || name.trim() === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
