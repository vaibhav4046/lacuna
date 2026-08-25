import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The first paint, which is the only thing a visitor has until the bundle
 * arrives, parses and runs.
 *
 * Measured before this shell existed: the landing page was pure black for
 * 1646ms on a fast connection and 4563ms on a throttled one, because `#root`
 * was empty and every pixel waited on JavaScript. Black for four seconds does
 * not read as loading. It reads as broken, and it was reported as broken.
 *
 * These assertions are about what paints without script, so they read the
 * shipped HTML and the stylesheet the head links, not the React tree.
 */

const html = readFileSync(fileURLToPath(new URL('../../web/index.html', import.meta.url)), 'utf8');
const bootCss = readFileSync(fileURLToPath(new URL('../../web/public/boot.css', import.meta.url)), 'utf8');

describe('the pre-script paint', () => {
  it('links the boot stylesheet before the module script', () => {
    const stylesheet = html.indexOf('/boot.css');
    const script = html.indexOf('<script type="module"');
    expect(stylesheet).toBeGreaterThan(-1);
    expect(script).toBeGreaterThan(-1);
    // A stylesheet after the script would paint after it, defeating the point.
    expect(stylesheet).toBeLessThan(script);
  });

  it('paints the product background rather than the browser default', () => {
    // Until this file existed the gap was a white flash on every cold load.
    expect(bootCss).toMatch(/background:\s*#000000/u);
  });

  it('puts something inside the root element for the browser to draw', () => {
    const root = /<div id="root">([\s\S]*?)<\/div>\s*<noscript>/u.exec(html);
    expect(root, 'the root element and its shell should be found').not.toBeNull();
    expect(root?.[1]).toContain('boot-shell');
    expect(root?.[1]).toContain('Lacuna');
  });

  it('styles every class the shell uses, since nothing else has loaded yet', () => {
    const classes = [...html.matchAll(/class="(boot-[a-z-]+)"/gu)].map((match) => match[1]);
    expect(classes.length).toBeGreaterThan(0);
    for (const name of new Set(classes)) {
      expect(bootCss, `${name} is used in the shell`).toContain(`.${name}`);
    }
  });

  it('hides the shell from assistive technology, because it is scaffolding', () => {
    expect(html).toMatch(/<div class="boot-shell" aria-hidden="true">/u);
  });

  it('carries no inline style or script, which the policy would refuse', () => {
    // The deployed policy is script-src 'self' with no nonce, so an inline
    // attribute here would be dropped in production and pass in a test.
    const shell = /<div id="root">([\s\S]*?)<\/div>\s*<noscript>/u.exec(html)?.[1] ?? '';
    expect(shell).not.toMatch(/style="/u);
    expect(shell).not.toMatch(/<script/u);
  });

  it('does not paint hero copy that React would clear and re-animate', () => {
    // The hero enters on a deliberate stagger from opacity zero. Painting its
    // words here would show them, clear them on mount, and fade them back in,
    // which is a worse first impression than the wordmark alone.
    const shell = /<div id="root">([\s\S]*?)<\/div>\s*<noscript>/u.exec(html)?.[1] ?? '';
    expect(shell).not.toContain('Memory that knows');
    expect(shell).not.toMatch(/<h1/u);
  });

  it('still tells a visitor with no JavaScript what happened', () => {
    expect(html).toContain('<noscript>');
    expect(html).toContain('Lacuna needs JavaScript.');
  });
});
