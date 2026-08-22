import type { HydraCloud, IngestResult } from '../hydra/cloud.js';
import { hashMcpCapability, mintMcpCapability } from './mcp-capability.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;

/** Private MCP bearers are deliberately short-lived as well as revocable. */
export const MCP_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

interface StoredCapability {
  readonly version: 2;
  readonly digest: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface IssuedMcpCapability {
  /** Returned once. Never persist or log this field. */
  readonly capability: string;
  readonly workspace: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface McpCapabilities {
  issue(workspace: string, now?: number): Promise<IssuedMcpCapability>;
  resolve(capability: string, now?: number): Promise<string | null>;
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

function instant(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? parsed : null;
}

function iso(value: number): string {
  if (!Number.isFinite(value)) throw new McpCapabilityStoreError('invalid capability time');
  try {
    return new Date(value).toISOString();
  } catch {
    throw new McpCapabilityStoreError('invalid capability time');
  }
}

function parse(text: string, expectedDigest: string): StoredCapability | null {
  try {
    const value = JSON.parse(text) as Partial<StoredCapability>;
    const createdAt = instant(value.createdAt);
    const expiresAt = instant(value.expiresAt);
    const revokedAt = value.revokedAt === null ? null : instant(value.revokedAt);
    if (value.version !== 2 || value.digest !== expectedDigest
      || typeof value.workspace !== 'string' || !WORKSPACE_SHAPE.test(value.workspace)
      || createdAt === null || expiresAt === null
      || expiresAt <= createdAt || expiresAt - createdAt > MCP_CAPABILITY_TTL_MS
      || (value.revokedAt !== null && (revokedAt === null || revokedAt < createdAt || revokedAt >= expiresAt))) return null;
    return value as StoredCapability;
  } catch {
    return null;
  }
}

function active(record: StoredCapability, now: number): boolean {
  if (!Number.isFinite(now) || record.revokedAt !== null) return false;
  return now >= Date.parse(record.createdAt) && now < Date.parse(record.expiresAt);
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
    const createdAt = iso(now);
    const expiresAt = iso(now + MCP_CAPABILITY_TTL_MS);
    await this.#write({
      version: 2,
      digest: hashMcpCapability(capability),
      workspace,
      createdAt,
      expiresAt,
      revokedAt: null,
    });
    return { capability, workspace, createdAt, expiresAt };
  }

  async resolve(capability: string, now: number = Date.now()): Promise<string | null> {
    const record = await this.#read(capability);
    return record === null || !active(record, now) ? null : record.workspace;
  }

  async revoke(capability: string, now: number = Date.now()): Promise<boolean> {
    const record = await this.#read(capability);
    if (record === null || !active(record, now)) return false;
    await this.#write({ ...record, revokedAt: iso(now) });
    return true;
  }
}
