import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const PART = /^[A-Za-z0-9_-]+$/u;

/** Encrypts OAuth refresh tokens before their dedicated durable store receives them. */
export class OAuthTokenVault {
  readonly #key: Buffer;

  constructor(key: Buffer) {
    if (key.byteLength !== 32) throw new Error('OAuth token key must be 32 bytes');
    this.#key = Buffer.from(key);
  }

  seal(provider: string, workspace: string, token: string): string {
    if (!valid(provider) || !valid(workspace) || token.length === 0 || token.length > 8_192) {
      throw new Error('invalid OAuth token record');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    cipher.setAAD(aad(provider, workspace));
    const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
  }

  open(provider: string, workspace: string, value: string): string {
    const parts = value.split('.');
    if (!valid(provider) || !valid(workspace) || parts.length !== 4 || parts[0] !== VERSION
      || !PART.test(parts[1] ?? '') || !PART.test(parts[2] ?? '') || !PART.test(parts[3] ?? '')) throw new Error('invalid OAuth token record');
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(parts[1]!, 'base64url'));
      decipher.setAAD(aad(provider, workspace));
      decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final()]).toString('utf8');
    } catch { throw new Error('invalid OAuth token record'); }
  }
}

function valid(value: string): boolean { return value.length > 0 && value.length <= 255; }
function aad(provider: string, workspace: string): Buffer { return Buffer.from(`${provider}\u0000${workspace}`, 'utf8'); }
