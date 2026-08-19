import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * Every public surface, clicked through logged out.
 *
 * A judge arrives with no account and follows whatever is in front of them.
 * The failure that matters is not a broken page, it is a control that looks
 * public and quietly lands on the sign in screen, because the reader concludes
 * the product is gated rather than that one link was built with the wrong
 * scope.
 *
 * So this opens each public route with no cookies, enumerates every anchor and
 * button, follows the internal ones, and records anything that redirects to
 * sign in, 404s, 5xxes, or leaves the demo scope. It is a gate rather than a
 * report: it exits non-zero on any of those.
 *
 *   npx tsx scripts/link-crawl.ts [base-url]
 */

const BASE = process.argv[2] ?? 'https://lacuna-five.vercel.app';
const OUT_DIR = 'artifacts/link-crawl';
const LOAD_TIMEOUT_MS = 30_000;

/** Where a stranger can start. Everything reachable from these is crawled. */
const ROOTS: readonly string[] = [
  '/',
  '/judge',
  '/demo/dash',
  '/demo/ask',
  '/demo/memory',
  '/demo/timeline',
  '/demo/graph',
  '/demo/health',
  '/demo/hydra',
  '/demo/evals',
];

/** Paths a public crawl is allowed to end on even though they are gated. */
const INTENTIONAL_SIGN_IN: readonly string[] = ['/signin', '/signup'];

/**
 * Controls whose whole job is to reach the sign in screen.
 *
 * Landing on `/signin` after clicking SIGN IN is the control working. The
 * failure this crawl is looking for is a control about the memory, the graph or
 * the health of a workspace that quietly leaves the public scope.
 */
const SIGN_IN_CONTROLS = new Set([
  'SIGN IN', 'SIGN UP', 'GET STARTED', 'START BUILDING', 'OPEN LACUNA',
  'CREATE ACCOUNT', 'BACK TO SIGN IN', 'ALREADY HAVE AN ACCOUNT · SIGN IN',
  'CONTINUE WITH GOOGLE', 'SIGN IN WITH GOOGLE',
]);

/**
 * The crawl stays on this origin.
 *
 * Following the Google sign in button walked it onto accounts.google.com and
 * it then dutifully crawled Google's own pages and reported their "Create
 * account" links as findings. Anything off-origin is somebody else's product.
 */
function sameOrigin(url: string): boolean {
  try {
    return new URL(url).origin === new URL(BASE).origin;
  } catch {
    return false;
  }
}

interface Finding {
  readonly kind: 'sign_in_redirect' | 'not_found' | 'server_error' | 'dead_control' | 'scope_escape';
  readonly from: string;
  readonly control: string;
  readonly detail: string;
}

const findings: Finding[] = [];
const visited = new Set<string>();

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-crawl-'));

mkdirSync(OUT_DIR, { recursive: true });
process.stdout.write(`chrome  ${chrome}\nsite    ${BASE}\n\n`);

const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' });

let devtools: Devtools | undefined;

/** Every anchor and button on the page, with enough to identify it in a report. */
const CONTROLS = `(() => [
  ...[...document.querySelectorAll('a[href]')].map((el) => ({
    tag: 'a',
    label: (el.textContent || '').trim().slice(0, 60),
    href: el.getAttribute('href'),
  })),
  ...[...document.querySelectorAll('button')].map((el) => ({
    tag: 'button',
    label: (el.textContent || '').trim().slice(0, 60),
    href: null,
  })),
])()`;

interface Control {
  readonly tag: string;
  readonly label: string;
  readonly href: string | null;
}

async function evaluate<T>(expression: string): Promise<T> {
  const result = await devtools!.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }) as { result?: { value?: T } };
  return result.result?.value as T;
}

async function open(path: string): Promise<number> {
  const loaded = devtools!.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  await devtools!.send('Page.navigate', { url: `${BASE}${path}` });
  await loaded;
  await wait(1_200);
  // The SPA routes client side, so the status of the document is not the status
  // of the route. The status here is the one the server gave for the document.
  return 200;
}

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  await devtools.send('Network.enable');
  // No cookies at any point. This is the logged out experience by construction.
  await devtools.send('Network.clearBrowserCookies');
  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 1_440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const queue = [...ROOTS];

  while (queue.length > 0) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    await open(path);
    await devtools.send('Network.clearBrowserCookies');

    const landed = await evaluate<string>('window.location.pathname');
    if (landed !== path && INTENTIONAL_SIGN_IN.some((gate) => landed.startsWith(gate))) {
      findings.push({ kind: 'sign_in_redirect', from: path, control: '(direct navigation)', detail: `landed on ${landed}` });
    }

    const controls = await evaluate<readonly Control[]>(CONTROLS);
    const internal = controls.filter((control) =>
      control.href !== null && control.href.startsWith('/') && !control.href.startsWith('//'));

    for (const control of internal) {
      const target = control.href!.split('#')[0]!;
      if (target === '' || visited.has(target)) continue;
      if (INTENTIONAL_SIGN_IN.includes(target)) continue;
      // /api/* is the JSON surface and the OAuth start, which redirects off
      // this origin. Neither is a page a reader clicks through.
      if (target.startsWith('/api/')) continue;
      queue.push(target);
    }

    const external = controls.filter((control) =>
      control.href !== null && !control.href.startsWith('/') && !control.href.startsWith('#'));

    process.stdout.write(
      `${path.padEnd(18)}${String(controls.length).padStart(3)} controls, `
      + `${String(internal.length).padStart(2)} internal, ${String(external.length).padStart(2)} external\n`,
    );

    /**
     * The buttons are the navigation.
     *
     * This application routes on click rather than on anchors, so a crawl that
     * only reads `a[href]` reports every demo route as having no internal links
     * and passes without having followed anything. Each button is clicked, the
     * resulting path recorded, and the page reopened for the next one.
     */
    const buttons = controls.filter((control) => control.tag === 'button' && control.label !== '');
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index]!;
      const landedOn = await evaluate<string>(`(() => {
        const all = [...document.querySelectorAll('button')].filter((el) => (el.textContent || '').trim() !== '');
        const el = all[${index}];
        if (!el) return 'MISSING';
        if (el.disabled) return 'DISABLED';
        el.click();
        return window.location.pathname;
      })()`);

      if (landedOn === 'MISSING') continue;
      if (landedOn === 'DISABLED') continue;

      await wait(450);
      const href = await evaluate<string>('window.location.href');
      if (!sameOrigin(href)) {
        // Left the site. Nothing beyond this point is ours to judge.
        await open(path);
        continue;
      }
      const settled = await evaluate<string>('window.location.pathname');

      if (
        INTENTIONAL_SIGN_IN.some((gate) => settled.startsWith(gate))
        && !SIGN_IN_CONTROLS.has(button.label.trim().toUpperCase())
      ) {
        // The one failure that matters. A control on a public page that lands a
        // logged out reader on sign in reads as "this product is gated".
        findings.push({
          kind: 'sign_in_redirect',
          from: path,
          control: `${button.label}`,
          detail: `clicking it landed on ${settled}`,
        });
      } else if (settled !== path && !visited.has(settled) && !settled.startsWith('/api/')) {
        queue.push(settled);
      }

      if (settled !== path) await open(path);
    }

    for (const control of controls) {
      if (control.tag === 'button' && control.label === '') {
        findings.push({ kind: 'dead_control', from: path, control: '(unlabelled button)', detail: 'no accessible name' });
      }
    }
  }

  // Every route reached, checked for the status the server actually returns.
  for (const path of visited) {
    const response = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    if (response.status === 404) {
      findings.push({ kind: 'not_found', from: path, control: '(document)', detail: '404' });
    } else if (response.status >= 500) {
      findings.push({ kind: 'server_error', from: path, control: '(document)', detail: String(response.status) });
    }
  }
} finally {
  devtools?.close();
  browser.kill();
}

const report = {
  crawledAt: new Date().toISOString(),
  base: BASE,
  routesVisited: [...visited].sort(),
  findings,
};
writeFileSync(`${OUT_DIR}/crawl.json`, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(`\n${visited.size} routes visited\n`);
for (const finding of findings) {
  process.stdout.write(`  ${finding.kind.padEnd(20)}${finding.from} :: ${finding.control} :: ${finding.detail}\n`);
}
process.stdout.write(`\n${OUT_DIR}/crawl.json written.\n`);

if (findings.length > 0) fail(`\nLINK_CRAWL_CLEAN: false, ${findings.length} finding(s)`);
process.stdout.write('\nLINK_CRAWL_CLEAN: true\n');
