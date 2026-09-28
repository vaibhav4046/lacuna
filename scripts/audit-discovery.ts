import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type AuditIssue = {
  check: string;
  path: string;
  message: string;
};

export type AuditResult = {
  ok: boolean;
  checks: number;
  files: number;
  issues: AuditIssue[];
};

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const CANONICAL_HOST = 'lacuna-five.vercel.app';
const CANONICAL_SITEMAP = `https://${CANONICAL_HOST}/sitemap.xml`;
const EXPECTED_TRACKER_HEADER = [
  'date',
  'wave',
  'platform',
  'asset',
  'qualified_views',
  'repository_visits',
  'demo_starts',
  'quickstart_attempts',
  'stars',
  'issues',
  'forks',
  'contributors',
  'inbound_messages',
  'notes',
] as const;

const read = (path: string): string => readFileSync(path, 'utf8');
const repoPath = (root: string, path: string): string => relative(root, path).replace(/\\/g, '/');

function markdownSources(root: string): string[] {
  const fixed = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/ROADMAP.md']
    .map((path) => join(root, path));
  const launchDir = join(root, 'docs', 'launch');
  const launch = existsSync(launchDir)
    ? readdirSync(launchDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map((entry) => join(launchDir, entry.name))
    : [];
  return [...fixed, ...launch];
}

function markdownDestination(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('<')) {
    const end = trimmed.indexOf('>');
    return end > 0 ? trimmed.slice(1, end) : trimmed;
  }
  const titled = trimmed.match(/^(\S+)(?:\s+["'][^"']*["'])?$/);
  return titled?.[1] ?? trimmed;
}

function localTarget(root: string, source: string, raw: string): string | null {
  let target = markdownDestination(raw);
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(target) || target.startsWith('#')) return null;
  target = target.split('#')[0]?.split('?')[0] ?? '';
  if (target === '') return null;
  try {
    target = decodeURIComponent(target);
  } catch {
    // Keep the literal target so the missing-path check reports it.
  }
  const absolute = target.startsWith('/')
    ? resolve(root, `.${target}`)
    : resolve(dirname(source), target);
  const rel = relative(root, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) return '__OUTSIDE_REPOSITORY__';
  return absolute;
}

function auditMarkdown(root: string, issues: AuditIssue[]): number {
  let checks = 0;
  for (const source of markdownSources(root)) {
    checks += 1;
    if (!existsSync(source)) {
      issues.push({ check: 'markdown-source', path: repoPath(root, source), message: 'required Markdown source is missing' });
      continue;
    }
    const content = read(source);
    const links = content.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g);
    for (const match of links) {
      const raw = match[1] ?? '';
      const target = localTarget(root, source, raw);
      if (target === null) continue;
      checks += 1;
      if (target === '__OUTSIDE_REPOSITORY__') {
        issues.push({ check: 'markdown-link', path: repoPath(root, source), message: `local link escapes the repository: ${raw}` });
      } else if (!existsSync(target)) {
        issues.push({ check: 'markdown-link', path: repoPath(root, source), message: `missing local target: ${raw}` });
      }
    }
  }
  return checks;
}

function validHttpsUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function auditJsonLd(root: string, issues: AuditIssue[]): number {
  const path = join(root, 'web', 'index.html');
  if (!existsSync(path)) {
    issues.push({ check: 'json-ld', path: 'web/index.html', message: 'web/index.html is missing' });
    return 1;
  }
  const html = read(path);
  const blocks = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let softwareApplication: Record<string, unknown> | null = null;
  for (const block of blocks) {
    try {
      const parsed: unknown = JSON.parse(block[1] ?? '');
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const found = nodes.find((node): node is Record<string, unknown> =>
        typeof node === 'object' && node !== null && (node as Record<string, unknown>)['@type'] === 'SoftwareApplication');
      if (found !== undefined) softwareApplication = found;
    } catch (error) {
      issues.push({ check: 'json-ld', path: 'web/index.html', message: `invalid JSON-LD: ${error instanceof Error ? error.message : String(error)}` });
    }
  }
  if (softwareApplication === null) {
    issues.push({ check: 'json-ld', path: 'web/index.html', message: 'SoftwareApplication JSON-LD block is missing' });
    return blocks.length + 1;
  }
  if (softwareApplication['@context'] !== 'https://schema.org') {
    issues.push({ check: 'json-ld', path: 'web/index.html', message: 'SoftwareApplication @context must be https://schema.org' });
  }
  if (typeof softwareApplication.name !== 'string' || softwareApplication.name.trim() === '') {
    issues.push({ check: 'json-ld', path: 'web/index.html', message: 'SoftwareApplication name must be a non-empty string' });
  }
  for (const field of ['url', 'codeRepository', 'license'] as const) {
    if (!validHttpsUrl(softwareApplication[field])) {
      issues.push({ check: 'json-ld', path: 'web/index.html', message: `SoftwareApplication ${field} must be an HTTPS URL` });
    }
  }
  return blocks.length + 5;
}

function auditRobots(root: string, issues: AuditIssue[]): number {
  const path = join(root, 'web', 'public', 'robots.txt');
  if (!existsSync(path)) {
    issues.push({ check: 'robots', path: 'web/public/robots.txt', message: 'robots.txt is missing' });
    return 1;
  }
  const hasSitemap = read(path)
    .split(/\r?\n/)
    .some((line) => line.trim() === `Sitemap: ${CANONICAL_SITEMAP}`);
  if (!hasSitemap) {
    issues.push({ check: 'robots', path: 'web/public/robots.txt', message: `missing canonical Sitemap: ${CANONICAL_SITEMAP}` });
  }
  return 1;
}

function auditSitemap(root: string, issues: AuditIssue[]): number {
  const path = join(root, 'web', 'public', 'sitemap.xml');
  if (!existsSync(path)) {
    issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: 'sitemap.xml is missing' });
    return 1;
  }
  const locations = [...read(path).matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((match) => match[1] ?? '');
  if (locations.length === 0) {
    issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: 'sitemap contains no <loc> values' });
  }
  const seen = new Set<string>();
  for (const location of locations) {
    if (seen.has(location)) {
      issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: `duplicate <loc>: ${location}` });
    }
    seen.add(location);
    try {
      const url = new URL(location);
      if (url.protocol !== 'https:') {
        issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: `<loc> must use HTTPS: ${location}` });
      }
      if (url.hostname !== CANONICAL_HOST) {
        issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: `<loc> must use ${CANONICAL_HOST}: ${location}` });
      }
    } catch {
      issues.push({ check: 'sitemap', path: 'web/public/sitemap.xml', message: `invalid <loc> URL: ${location}` });
    }
  }
  return Math.max(1, locations.length * 3);
}

export function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (quoted) throw new Error('unterminated quoted CSV field');
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function auditTracker(root: string, issues: AuditIssue[]): number {
  const path = join(root, 'docs', 'launch', 'STAR_TRACKER.csv');
  if (!existsSync(path)) {
    issues.push({ check: 'launch-csv', path: 'docs/launch/STAR_TRACKER.csv', message: 'launch tracker is missing' });
    return 1;
  }
  let rows: string[][];
  try {
    rows = parseCsv(read(path));
  } catch (error) {
    issues.push({ check: 'launch-csv', path: 'docs/launch/STAR_TRACKER.csv', message: error instanceof Error ? error.message : String(error) });
    return 1;
  }
  const header = rows[0] ?? [];
  if (header.join(',') !== EXPECTED_TRACKER_HEADER.join(',')) {
    issues.push({ check: 'launch-csv', path: 'docs/launch/STAR_TRACKER.csv', message: 'launch tracker header does not match the expected schema' });
  }
  const width = header.length;
  rows.slice(1).forEach((row, index) => {
    if (row.length !== width) {
      issues.push({ check: 'launch-csv', path: 'docs/launch/STAR_TRACKER.csv', message: `row ${index + 2} has ${row.length} columns; expected ${width}` });
    }
  });
  return Math.max(1, rows.length);
}

export function auditDiscovery(root = ROOT): AuditResult {
  const issues: AuditIssue[] = [];
  const sources = markdownSources(root);
  const checks = auditMarkdown(root, issues)
    + auditJsonLd(root, issues)
    + auditRobots(root, issues)
    + auditSitemap(root, issues)
    + auditTracker(root, issues);
  const files = sources.filter((path) => existsSync(path) && statSync(path).isFile()).length + 4;
  return { ok: issues.length === 0, checks, files, issues };
}

function main(): void {
  const result = auditDiscovery();
  if (result.ok) {
    console.log(`Discovery audit passed (${result.checks} checks across ${result.files} files).`);
    return;
  }
  console.error(`Discovery audit failed with ${result.issues.length} issue(s):`);
  for (const issue of result.issues) {
    console.error(`- [${issue.check}] ${issue.path}: ${issue.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
