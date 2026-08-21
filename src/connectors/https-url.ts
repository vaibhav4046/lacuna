import { isIP } from 'node:net';

export const MAX_HTTPS_URL_BYTES = 2_048;

export interface CanonicalPublicHttpsUrl {
  readonly hostname: string;
  readonly origin: string;
  readonly pathname: string;
  readonly requestPath: string;
}

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const NUMERIC_HOST = /^(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)(?:\.(?:0x[0-9a-f]+|0[0-7]+|[0-9]+)){0,3}$/iu;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/iu;
const MALFORMED_ESCAPE = /%(?![0-9a-f]{2})/iu;
const FORBIDDEN_HOSTS = new Set([
  'localhost', 'localhost.localdomain', 'metadata', 'metadata.google.internal',
  'instance-data', 'instance-data.ec2.internal',
]);
const FORBIDDEN_SUFFIXES = [
  '.localhost', '.local', '.internal', '.home.arpa', '.onion', '.in-addr.arpa', '.ip6.arpa',
];

function canonicalDnsHostname(value: string): string | null {
  const hostname = value.toLowerCase();
  if (hostname.length === 0 || hostname.length > 253 || hostname.endsWith('.')
    || hostname.includes('xn--') || NUMERIC_HOST.test(hostname) || isIP(hostname) !== 0
    || FORBIDDEN_HOSTS.has(hostname) || FORBIDDEN_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return null;
  }
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some((label) => !DNS_LABEL.test(label))) return null;
  return hostname;
}

/** Strict pre-WHATWG URL boundary. Only the query survives into the one request. */
export function canonicalizePublicHttpsUrl(value: unknown): CanonicalPublicHttpsUrl | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HTTPS_URL_BYTES
    || Buffer.byteLength(value, 'utf8') > MAX_HTTPS_URL_BYTES || !/^https:\/\//u.test(value)
    || !/^[\x21-\x7e]+$/u.test(value) || value.includes('\\') || value.includes('#')
    || ENCODED_CONTROL.test(value) || MALFORMED_ESCAPE.test(value)) return null;

  const authorityStart = 'https://'.length;
  const suffixOffset = value.slice(authorityStart).search(/[/?#]/u);
  const authorityEnd = suffixOffset < 0 ? value.length : authorityStart + suffixOffset;
  const authority = value.slice(authorityStart, authorityEnd);
  if (authority.length === 0 || /[%@\[\]]/u.test(authority)) return null;
  const colon = authority.indexOf(':');
  if (colon >= 0 && (authority.lastIndexOf(':') !== colon || authority.slice(colon) !== ':443')) return null;
  const rawHostname = colon < 0 ? authority : authority.slice(0, colon);
  if (rawHostname.endsWith('.') || rawHostname.includes('..')) return null;
  const hostname = canonicalDnsHostname(rawHostname);
  if (hostname === null) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== ''
      || url.hostname !== hostname || (url.port !== '' && url.port !== '443')) return null;
    const pathname = url.pathname.replace(/%[0-9a-f]{2}/giu, (escape) => {
      const byte = Number.parseInt(escape.slice(1), 16);
      return (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
        || (byte >= 0x30 && byte <= 0x39) || byte === 0x2d || byte === 0x2e
        || byte === 0x5f || byte === 0x7e
        ? String.fromCharCode(byte)
        : `%${escape.slice(1).toUpperCase()}`;
    });
    return Object.freeze({
      hostname,
      origin: `https://${hostname}/`,
      pathname,
      requestPath: `${pathname}${url.search}`,
    });
  } catch {
    return null;
  }
}

function parseIpv4(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

function inIpv4Range(value: number, network: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffff_ffff << (32 - prefix)) >>> 0;
  return ((value & mask) >>> 0) === ((network & mask) >>> 0);
}

const NON_GLOBAL_IPV4: readonly [number, number][] = Object.freeze([
  [0x0000_0000, 8], [0x0a00_0000, 8], [0x6440_0000, 10], [0x7f00_0000, 8],
  [0xa9fe_0000, 16], [0xac10_0000, 12], [0xc000_0000, 24], [0xc000_0200, 24],
  [0xc01f_c400, 24], [0xc034_c100, 24], [0xc058_6300, 24], [0xc0a8_0000, 16],
  [0xc0af_3000, 24], [0xc612_0000, 15], [0xc633_6400, 24], [0xcb00_7100, 24],
  [0xe000_0000, 4], [0xf000_0000, 4],
]);

function parseIpv6(value: string): bigint | null {
  if (value.length === 0 || value !== value.toLowerCase() || value.includes('%') || value.includes('.')) return null;
  if (!/^[0-9a-f:]+$/u.test(value) || value.indexOf('::') !== value.lastIndexOf('::')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : halves[0]!.split(':');
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]!.split(':');
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right].map((part) => Number.parseInt(part, 16));
  if (words.length !== 8) return null;
  let result = 0n;
  for (const word of words) result = (result << 16n) | BigInt(word);
  return canonicalIpv6(words) === value ? result : null;
}

function canonicalIpv6(words: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < words.length;) {
    if (words[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < words.length && words[end] === 0) end += 1;
    const length = end - index;
    if (length >= 2 && length > bestLength) {
      bestStart = index;
      bestLength = length;
    }
    index = end;
  }
  const hexadecimal = words.map((word) => word.toString(16));
  if (bestStart < 0) return hexadecimal.join(':');
  const left = hexadecimal.slice(0, bestStart).join(':');
  const right = hexadecimal.slice(bestStart + bestLength).join(':');
  return `${left}::${right}`;
}

function ipv6Prefix(value: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (value >> shift) === (network >> shift);
}

const IPV6_2000 = 0x2000_0000_0000_0000_0000_0000_0000_0000n;
const IPV6_2001 = 0x2001_0000_0000_0000_0000_0000_0000_0000n;
const IPV6_DOCUMENTATION = 0x2001_0db8_0000_0000_0000_0000_0000_0000n;
const IPV6_6TO4 = 0x2002_0000_0000_0000_0000_0000_0000_0000n;
const IPV6_DOCUMENTATION_2 = 0x3fff_0000_0000_0000_0000_0000_0000_0000n;
const IPV6_6BONE = 0x3ffe_0000_0000_0000_0000_0000_0000_0000n;
const IPV6_AS112 = 0x2620_004f_8000_0000_0000_0000_0000_0000n;

/** Accept only canonical textual global-unicast addresses. */
export function isGlobalUnicastAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ipv4 = parseIpv4(value);
  if (ipv4 !== null) return !NON_GLOBAL_IPV4.some(([network, prefix]) => inIpv4Range(ipv4, network, prefix));
  const ipv6 = parseIpv6(value);
  if (ipv6 === null || !ipv6Prefix(ipv6, IPV6_2000, 3)) return false;
  return !ipv6Prefix(ipv6, IPV6_2001, 23)
    && !ipv6Prefix(ipv6, IPV6_DOCUMENTATION, 32)
    && !ipv6Prefix(ipv6, IPV6_6TO4, 16)
    && !ipv6Prefix(ipv6, IPV6_DOCUMENTATION_2, 20)
    && !ipv6Prefix(ipv6, IPV6_6BONE, 16)
    && !ipv6Prefix(ipv6, IPV6_AS112, 48);
}

export function addressFamily(value: string): 4 | 6 {
  return parseIpv4(value) === null ? 6 : 4;
}

export function compareCanonicalAddresses(left: string, right: string): number {
  const leftFamily = addressFamily(left);
  const rightFamily = addressFamily(right);
  if (leftFamily !== rightFamily) return leftFamily - rightFamily;
  if (leftFamily === 4) return (parseIpv4(left) ?? 0) - (parseIpv4(right) ?? 0);
  const leftValue = parseIpv6(left) ?? 0n;
  const rightValue = parseIpv6(right) ?? 0n;
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
