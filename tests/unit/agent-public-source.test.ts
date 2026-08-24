import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { usesBaseAgentCollection } from '../../src/agent/source-scope.js';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));

describe('agent workspace source scoping', () => {
  it('maps the logical public workspace to the configured base Hydra collection', () => {
    expect(usesBaseAgentCollection(null)).toBe(true);
    expect(usesBaseAgentCollection('public')).toBe(true);
    expect(usesBaseAgentCollection('a3f8cc0deed84502b118729f18848bb3')).toBe(false);
  });

  it('wires the Vercel agent boundary through the public-workspace guard', () => {
    const entry = readFileSync(resolve(ROOT, 'api/index.ts'), 'utf8');
    expect(entry).toContain(
      'source: new CloudSource(usesBaseAgentCollection(collection) ? cloud : cloud.withCollection(collection)),'
    );
  });
});
