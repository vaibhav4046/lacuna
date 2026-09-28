import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { auditDiscovery, parseCsv } from '../../scripts/audit-discovery.js';

const roots: string[] = [];
const trackerHeader = 'date,wave,platform,asset,qualified_views,repository_visits,demo_starts,quickstart_attempts,stars,issues,forks,contributors,inbound_messages,notes';

function fixture(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'lacuna-discovery-audit-'));
  roots.push(root);
  const files: Record<string, string> = {
    'README.md': '# Fixture\n[Roadmap](docs/ROADMAP.md)\n',
    'CONTRIBUTING.md': '# Contributing\n[Roadmap](docs/ROADMAP.md)\n',
    'SECURITY.md': '# Security\nSee https://example.com/security.\n',
    'docs/ROADMAP.md': '# Roadmap\n',
    'docs/launch/LAUNCH.md': '# Launch\n[Root](../../README.md)\n',
    'docs/launch/STAR_TRACKER.csv': `${trackerHeader}\n2026-08-23,baseline,GitHub,baseline,,,,,1,2,0,,,\n`,
    'web/index.html': '<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Lacuna","url":"https://lacuna-five.vercel.app/","codeRepository":"https://github.com/vaibhav4046/lacuna","license":"https://www.apache.org/licenses/LICENSE-2.0"}</script>\n',
    'web/public/robots.txt': 'User-agent: *\nAllow: /\nSitemap: https://lacuna-five.vercel.app/sitemap.xml\n',
    'web/public/sitemap.xml': '<urlset><url><loc>https://lacuna-five.vercel.app/</loc></url><url><loc>https://lacuna-five.vercel.app/explore</loc></url></urlset>\n',
    ...overrides,
  };
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('offline discovery audit', () => {
  it('accepts a complete local discovery fixture', () => {
    const result = auditDiscovery(fixture());
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('fails when a checked Markdown file points at a missing local target', () => {
    const root = fixture({ 'README.md': '# Fixture\n[Missing](docs/missing.md)\n' });
    const result = auditDiscovery(root);
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      check: 'markdown-link',
      path: 'README.md',
      message: 'missing local target: docs/missing.md',
    }));
  });

  it('parses quoted CSV fields without changing row width', () => {
    expect(parseCsv('a,b\n"x,y",z\n')).toEqual([['a', 'b'], ['x,y', 'z']]);
  });
});
