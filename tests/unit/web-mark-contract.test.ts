import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('../../web/src/design/mark.tsx', import.meta.url)),
  'utf8',
);

describe('the approved Lacuna web mark', () => {
  it('is the original white open spiral with one amber origin', () => {
    expect(source).toContain('stroke="#FFFFFF"');
    expect(source).toContain('strokeWidth="1.9"');
    expect(source).toContain('<circle cx="12" cy="2.6" r="1.9" fill="#FFB829" />');
    expect(source.match(/<path/g)).toHaveLength(1);
    expect(source.match(/<circle/g)).toHaveLength(1);
  });

  it('has no purple halo or secondary stroke', () => {
    expect(source).not.toContain('#8052FF');
    expect(source).not.toContain('strokeOpacity');
  });
});
