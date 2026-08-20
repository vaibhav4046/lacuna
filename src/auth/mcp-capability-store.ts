import type { HydraCloud, IngestResult } from '../hydra/cloud.js';
import { hashMcpCapability, mintMcpCapability } from './mcp-capability.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;

interface StoredCapability {
  readonly version: 1;
  readonly digest: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface IssuedMcpCapability {
  /** Returned once. Never persist or log this field. */
  readonly capability: string;
  readonly workspace: string;
  readonly createdAt: string;
}

export interface McpCapabilities {
  issue(workspace: string, now?: number): Promise<IssuedMcpCapability>;
  resolve(capability: string): Promise<string | null>;
  revoke(capability: string, now?: number): Promise<boolean>;
}

export class McpCapabilityStoreError extends Error {
  override readonly name = 'McpCapabilityStoreError';
}

function assertWorkspace(workspace: string): void {
  if (!WORKSPACE_SHAPE.test(workspace)) throw new McpCapabilityStoreError('invalid workspace');
}

function idFor(digest: string): string {
  return `lacuna:mcp-capability:${digest}`;
}

function parse(text: string, expectedDigest: string): StoredCapability | null {
  try {
    const value = JSON.parse(text) as Partial<StoredCapability>;
    if (value.version !== 1 || value.digest !== expectedDigest
      || typeof value.workspace !== 'string' || !WORKSPACE_SHAPE.test(value.workspace)
      || typeof value.createdAt !== 'string'
      || (value.revokedAt !== null && typeof value.revokedAt !== 'string')) return null;
    return value as StoredCapability;
  } catch {
    return null;
  }
}

function unwrap(envelope: string): string | null {
  try {
    const value = JSON.parse(envelope) as { content?: { text?: unknown } };
    return typeof value.content?.text === 'string' ? value.content.text : null;
  } catch {
    return null;
  }
}

/**
 * Exact-id capability records in a collection separate from accounts and
 * memory. The raw bearer is never sent to HydraDB; lookup hashes it first.
 */
export class CloudMcpCapabilities implements McpCapabilities {
  readonly #cloud: HydraCloud;
  readonly #collection: string;

  constructor(cloud: HydraCloud, collection = 'lacuna-mcp-capabilities') {
    this.#cloud = cloud;
    this.#collection = collection;
  }

  async #write(record: StoredCapability): Promise<void> {
    const results: readonly IngestResult[] = await this.#cloud.ingestApp([{
      id: idFor(record.digest),
      title: 'Lacuna MCP capability',
      type: 'custom',
      timestamp: record.revokedAt ?? record.createdAt,
      text: JSON.stringify(record),
      metadata: { lacuna_record: 'mcp_capability' },
    }], this.#collection);
    if (results.length !== 1 || results.some((result) => result.error !== null && result.error !== '')) {
      throw new McpCapabilityStoreError('capability write was refused');
    }
  }

  async #read(capability: string): Promise<StoredCapability | null> {
    let digest: string;
    try {
      digest = hashMcpCapability(capability);
    } catch {
      return null;
    }
    const source = await this.#cloud.inspect(idFor(digest), 10_000, this.#collection);
    if (source === null) return null;
    const text = unwrap(source.envelope);
    return text === null ? null : parse(text, digest);
  }

  async issue(workspace: string, now: number = Date.now()): Promise<IssuedMcpCapability> {
    assertWorkspace(workspace);
    const capability = mintMcpCapability();
    const createdAt = new Date(now).toISOString();
    await this.#write({
      version: 1,
      digest: hashMcpCapability(capability),
      workspace,
      createdAt,
      revokedAt: null,
    });
    return { capability, workspace, createdAt };
  }

  async resolve(capability: string): Promise<string | null> {
    const record = await this.#read(capability);
    return record === null || record.revokedAt !== null ? null : record.workspace;
  }

  async revoke(capability: string, now: number = Date.now()): Promise<boolean> {
    const record = await this.#read(capability);
    if (record === null || record.revokedAt !== null) return false;
    await this.#write({ ...record, revokedAt: new Date(now).toISOString() });
    return true;
  }
}
