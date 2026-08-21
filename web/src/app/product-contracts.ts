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
