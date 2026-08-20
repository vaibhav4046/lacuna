import { createHash, randomBytes } from 'node:crypto';

/** 256 random bits, named so it cannot be mistaken for a collection id. */
export const MCP_CAPABILITY_SHAPE = /^lmc_[A-Za-z0-9_-]{43}$/u;

export function mintMcpCapability(): string {
  return `lmc_${randomBytes(32).toString('base64url')}`;
}

/** Store and index only this digest. The bearer value is shown once. */
export function hashMcpCapability(capability: string): string {
  if (!MCP_CAPABILITY_SHAPE.test(capability)) throw new Error('invalid MCP capability');
  return createHash('sha256').update(capability, 'utf8').digest('hex');
}
