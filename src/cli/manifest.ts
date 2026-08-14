import { readFileSync } from 'node:fs';

/**
 * Two facts read out of package.json instead of repeated in a constant.
 *
 * The version and the supported Node range already exist in the manifest, and a
 * copy of either in a source file is a second place to forget. Neither read
 * throws: a `--version` that fails to print because the manifest moved is worse
 * than one that prints "unknown", and `doctor` reporting an unknown requirement
 * is more useful than `doctor` crashing before it reaches the node checks.
 */

const UNKNOWN_VERSION = 'unknown';

/** Matches the engines field in package.json at the time of writing. */
const FALLBACK_NODE_RANGE = '>=20.11.0';

function manifest(root: URL): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function readVersion(root: URL): string {
  const version = manifest(root)?.['version'];
  return typeof version === 'string' ? version : UNKNOWN_VERSION;
}

export function readRequiredNode(root: URL): string {
  const engines = manifest(root)?.['engines'];
  if (typeof engines === 'object' && engines !== null) {
    const node = (engines as Record<string, unknown>)['node'];
    if (typeof node === 'string') return node;
  }
  return FALLBACK_NODE_RANGE;
}
