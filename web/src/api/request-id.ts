/**
 * Request ids used by browser mutations must work in embedded browsers too.
 * Some expose Web Crypto but omit the convenience randomUUID method.
 */
export function createClientRequestId(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  let value: string;
  if (typeof cryptoApi?.randomUUID === 'function') {
    value = cryptoApi.randomUUID();
  } else {
    const bytes = new Uint8Array(16);
    if (typeof cryptoApi?.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
    else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    value = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${prefix}-${value}`;
}
