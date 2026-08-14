/**
 * Recorded-replay transport for the public deployment.
 *
 * The exporter (scripts/export-snapshot.ts) runs the production read queries
 * against a live HydraDB node and tees every wire request/response pair into a
 * JSON snapshot. This module is the other half: a FetchLike that answers those
 * same requests from the snapshot, byte for byte, so the real client decode
 * path, resolver and views run unmodified. Nothing here reimplements query
 * semantics; a request the snapshot has never seen is a transport error, not a
 * guess.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FetchLike } from '../hydra/client.js';
import { HydraTransportError } from '../hydra/errors.js';

export interface SnapshotEntry {
  readonly cypher: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** The node's wire response body, verbatim. */
  readonly body: string;
}

export interface SnapshotNode {
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
}

export interface GraphSnapshot {
  readonly exportedAt: string;
  readonly seed: string;
  readonly node: SnapshotNode;
  readonly counts: {
    readonly entities: number;
    readonly claims: number;
    readonly entries: number;
  };
  /**
   * The node's reply for a name that is not in the graph: zero rows. Any
   * entity-by-name lookup the snapshot has no entry for gets this reply,
   * which is exactly what the live node returns for an absent name.
   */
  readonly absent: {
    readonly cypher: string;
    readonly body: string;
  };
  readonly entries: readonly SnapshotEntry[];
}

/** The snapshot file is malformed, truncated or internally inconsistent. */
export class SnapshotError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * One string per (query, parameters) pair, identical whether the parameters
 * came from the exporter's wire capture or a fresh request at replay time.
 * Key order is normalised; parameter values are compared post-parse, so JSON
 * formatting differences cannot split a pair.
 */
export function canonicalKey(
  cypher: string,
  parameters: Readonly<Record<string, unknown>>,
): string {
  const names = Object.keys(parameters).sort();
  const pairs = names.map((name) => [name, parameters[name]]);
  return JSON.stringify([cypher, pairs]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new SnapshotError(`snapshot field "${field}" is not a string`);
  }
  return value;
}

export function parseSnapshot(text: string): GraphSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    throw new SnapshotError('snapshot file is not valid JSON', { cause });
  }
  if (!isRecord(raw)) {
    throw new SnapshotError('snapshot file is not a JSON object');
  }

  const node = raw['node'];
  if (!isRecord(node)) {
    throw new SnapshotError('snapshot has no node object');
  }
  const counts = raw['counts'];
  if (!isRecord(counts)) {
    throw new SnapshotError('snapshot has no counts object');
  }
  for (const field of ['entities', 'claims', 'entries']) {
    if (typeof counts[field] !== 'number') {
      throw new SnapshotError(`snapshot count "${field}" is not a number`);
    }
  }
  const absent = raw['absent'];
  if (!isRecord(absent)) {
    throw new SnapshotError('snapshot has no absent-name reply');
  }
  const entries = raw['entries'];
  if (!Array.isArray(entries)) {
    throw new SnapshotError('snapshot entries is not an array');
  }

  const parsedEntries: SnapshotEntry[] = entries.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new SnapshotError(`snapshot entry ${index} is not an object`);
    }
    const parameters = entry['parameters'];
    if (!isRecord(parameters)) {
      throw new SnapshotError(`snapshot entry ${index} has no parameters object`);
    }
    return {
      cypher: requireString(entry, 'cypher'),
      parameters,
      body: requireString(entry, 'body'),
    };
  });

  const snapshot: GraphSnapshot = {
    exportedAt: requireString(raw, 'exportedAt'),
    seed: requireString(raw, 'seed'),
    node: {
      namespace: requireString(node, 'namespace'),
      graph: requireString(node, 'graph'),
      cell: requireString(node, 'cell'),
    },
    counts: {
      entities: counts['entities'] as number,
      claims: counts['claims'] as number,
      entries: counts['entries'] as number,
    },
    absent: {
      cypher: requireString(absent, 'cypher'),
      body: requireString(absent, 'body'),
    },
    entries: parsedEntries,
  };

  if (snapshot.entries.length !== snapshot.counts.entries) {
    throw new SnapshotError(
      `snapshot says ${snapshot.counts.entries} entries but holds `
      + `${snapshot.entries.length}`,
    );
  }
  return snapshot;
}

/**
 * A FetchLike over the snapshot. The client builds the same wire request it
 * would send to the node; this reads the query and parameters back out of it
 * and answers with the recorded body. Misses are HydraTransportError, which
 * the server already renders as an upstream notice — a replay gap looks like
 * an unreachable node, never like an empty result.
 */
export function snapshotTransport(snapshot: GraphSnapshot): FetchLike {
  const replies = new Map<string, string>();
  for (const entry of snapshot.entries) {
    const key = canonicalKey(entry.cypher, entry.parameters);
    const existing = replies.get(key);
    if (existing !== undefined && existing !== entry.body) {
      throw new SnapshotError(
        'snapshot holds two different replies for the same query; '
        + 'it was recorded while something was writing',
      );
    }
    replies.set(key, entry.body);
  }

  const respond = (body: string): Response =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  return async (_input, init) => {
    if (typeof init.body !== 'string') {
      throw new HydraTransportError('snapshot replay expected a string request body');
    }
    let wire: unknown;
    try {
      wire = JSON.parse(init.body);
    } catch (cause) {
      throw new HydraTransportError('snapshot replay could not parse the wire request', {
        cause,
      });
    }
    if (!isRecord(wire) || typeof wire['query'] !== 'string') {
      throw new HydraTransportError('snapshot replay saw a wire request with no query');
    }
    if (wire['cursor'] !== undefined) {
      throw new HydraTransportError(
        'snapshot replay holds single-page replies only, and this request '
        + 'asked for a cursor continuation',
      );
    }
    const parameters = isRecord(wire['parameters']) ? wire['parameters'] : {};
    const found = replies.get(canonicalKey(wire['query'], parameters));
    if (found !== undefined) {
      return respond(found);
    }
    if (wire['query'] === snapshot.absent.cypher) {
      // An entity-by-name lookup for a name the exporter never saw. The graph
      // does not contain it — the roster was enumerated in full at export
      // time — so the node's zero-row reply for an absent name is the honest
      // answer, not a fabricated one.
      return respond(snapshot.absent.body);
    }
    throw new HydraTransportError(
      'this deployment replays a recorded snapshot and has no recorded reply '
      + 'for that query',
    );
  };
}

/** Reads the committed snapshot from artifacts/snapshot/. */
/**
 * `root` is the directory holding `artifacts/`, for callers that cannot trust
 * `import.meta.url`: a bundler moves this file and the URL moves with it, but
 * the committed artifact stays where the repository put it. Local callers omit
 * it and get the path resolved against this file, as before.
 */
export function loadSnapshot(root?: string): GraphSnapshot {
  const path = root === undefined
    ? fileURLToPath(new URL('../../artifacts/snapshot/graph-snapshot.json', import.meta.url))
    : join(root, 'artifacts', 'snapshot', 'graph-snapshot.json');
  return parseSnapshot(readFileSync(path, 'utf8'));
}
