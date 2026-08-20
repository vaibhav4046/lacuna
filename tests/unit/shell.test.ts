import { describe, expect, it } from 'vitest';

import { handleLine } from '../../src/cli/shell.js';
import { PLAIN } from '../../src/cli/color.js';

/**
 * The prompt, minus the terminal.
 *
 * `handleLine` is split out of the loop precisely so this can exist: the loop
 * is readline plumbing and this is the behaviour. Nothing here reaches a store,
 * so what is checked is the part that must hold whether or not one answers —
 * that a colon command is a command, that an unknown one is refused rather than
 * sent to the resolver as a question, and that leaving means leaving.
 */

function collect() {
  const lines: string[] = [];
  return {
    lines,
    deps: {
      env: {},
      palette: PLAIN,
      timeoutMs: 1_000,
      out: (text: string) => { lines.push(text); },
    },
  };
}

describe('a line typed at the prompt', () => {
  it('does nothing when it is empty', async () => {
    const { lines, deps } = collect();
    expect(await handleLine('   ', deps)).toBe('continue');
    expect(lines).toEqual([]);
  });

  it('leaves on any of the ways people type it', async () => {
    const { deps } = collect();
    for (const word of [':quit', ':q', ':exit']) {
      expect(await handleLine(word, deps)).toBe('quit');
    }
  });

  it('prints help that names the abstentions, because they are answers here', async () => {
    const { lines, deps } = collect();
    await handleLine(':help', deps);
    const text = lines.join('\n');
    expect(text).toContain('contradicted');
    expect(text).toContain('retracted');
    expect(text).toContain('never stated');
  });

  it('refuses an unknown colon command rather than asking the store about it', async () => {
    // The important half is that it does not fall through. ":subjcts" is a typo,
    // and sending it to the parser would report that the workspace holds no such
    // name, which sends somebody looking in entirely the wrong place.
    const { lines, deps } = collect();
    expect(await handleLine(':subjcts', deps)).toBe('continue');
    expect(lines.join('\n')).toContain('no command');
    expect(lines.join('\n')).toContain(':help');
  });

  it('treats a question mark on its own as help rather than as a question', async () => {
    const { lines, deps } = collect();
    await handleLine('?', deps);
    expect(lines.join('\n')).toContain('Commands');
  });
});
