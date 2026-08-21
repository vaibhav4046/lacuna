import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * Every route, in a real browser, with the console kept.
 *
 *   npm run audit:routes
 *   npm run audit:routes -- https://lacuna-five.vercel.app
 *
 * `RELEASE_GATE.md` claimed no console errors across the application routes and
 * had nothing behind the claim except somebody having looked. That is the one
 * kind of entry the gate is not allowed to contain, because a person looking at
 * eighteen screens once is exactly the check that quietly stops happening.
 *
 * So this opens each route, waits for it to finish drawing, and records what
 * the browser said: console errors, uncaught exceptions, and requests that
 * failed or answered 400 and above. It also measures the two things that are
 * invisible in a screenshot and obvious to a visitor. Whether the document
 * scrolls sideways, which is what a fixed width element does to a phone. And
 * whether anything was drawn at all, because a route that mounts and throws
 * renders a clean empty page that looks fine in a list of passing URLs.
 *
 * Nine viewports, 360px through 4K, since half the failures only exist at one
 * of them. The pass at phone width is what found every signed-in route
 * scrolling sideways while every public page was clean.
 *
 * A request answering 401 is not a failure here. Several of these screens ask
 * for a session before they know they do not have one, and the deployment
 * refusing an unauthenticated read is the system working. The audit records
 * those separately rather than counting them as errors or hiding them.
 */

const base = (process.argv[2] ?? 'https://lacuna-five.vercel.app').replace(/\/+$/, '');
const OUT_DIR = fileURLToPath(new URL('../artifacts/route-audit', import.meta.url));

/** The eighteen route keys in web/src/app/routes.ts, in sidebar order. */
const APP_ROUTES = [
  'dash', 'ask', 'memory', 'timeline', 'graph', 'health',
  'work', 'agents', 'tools', 'models', 'voice',
  'mcp', 'sdk', 'cli', 'conn', 'evals', 'hydra', 'settings',
] as const;

/**
 * `/docs` is deliberately absent.
 *
 * It was in this list and it passed, with more drawn text than most routes.
 * Nothing in the application defines it and nothing links to it: the catch all
 * rewrite sends every unknown path to index.html, so `/docs` rendered the
 * landing page and the audit counted a route that does not exist as working.
 * Widening the sweep to nine viewports widened that blind spot nine ways.
 *
 * The check below closes the class rather than the instance, so a path added
 * here in future cannot pass on the same trick.
 */
const PATHS = [
  '/',
  '/judge',
  '/signin',
  '/signup',
  ...APP_ROUTES.map((route) => `/demo/${route}`),
];

/**
 * The widths a reader actually has, rather than the two a developer checks.
 *
 * Small phone through to a 4K desktop. The 360 and 430 ends are the ones that
 * matter: the first is the narrowest screen still in common use and the second
 * is a large phone, and a layout that survives both survives the middle. The
 * pass at 375 is what found every signed-in route scrolling sideways.
 */
const VIEWPORTS = [
  { name: 'phone-360', width: 360, height: 800 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'tablet-768', width: 768, height: 1_024 },
  { name: 'laptop-1366', width: 1_366, height: 768 },
  { name: 'laptop-1440', width: 1_440, height: 900 },
  { name: 'desktop-1920', width: 1_920, height: 1_080 },
  { name: 'desktop-2560', width: 2_560, height: 1_440 },
  { name: 'desktop-3840', width: 3_840, height: 2_160 },
] as const;

/**
 * Reduced motion is a correctness question here, not a preference.
 *
 * The landing page explains the product through a field of moving particles.
 * A reader who has asked their system for less motion gets the static state,
 * and the static state still has to say what the product does. So the sweep is
 * run once more with the preference set, and a route that draws nothing under
 * it fails exactly as it would with motion on.
 */
const REDUCED_MOTION = process.argv.includes('--reduced-motion');

/** Long enough for a route that mounts, asks the API and then draws. */
const SETTLE_MS = 1_200;
const LOAD_TIMEOUT_MS = 25_000;

interface Finding {
  readonly path: string;
  readonly viewport: string;
  readonly consoleErrors: readonly string[];
  readonly exceptions: readonly string[];
  readonly failedRequests: readonly string[];
  readonly unauthorised: number;
  readonly horizontalOverflowPx: number;
  readonly textLength: number;
  /** True when a non-root path drew the landing page, so it is not a route. */
  readonly renderedTheLandingPage: boolean;
  readonly ok: boolean;
}

const print = (line: string): void => void process.stdout.write(`${line}\n`);

try {
  const probe = await fetch(`${base}/`, { signal: AbortSignal.timeout(8_000) });
  if (!probe.ok) fail(`${base} answered ${probe.status}; not auditing that`);
} catch {
  fail(`nothing answering at ${base}`);
}

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-audit-'));

const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  'about:blank',
], { stdio: 'ignore' });

print(`base      ${base}`);
print(`routes    ${PATHS.length}`);
print(`viewports ${VIEWPORTS.map((viewport) => viewport.name).join(', ')}\n`);

const findings: Finding[] = [];
let devtools: Devtools | undefined;
/** The landing page's opening text at the current viewport. */
let rootHead: string | null = null;

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  await devtools.send('Network.enable');

  if (REDUCED_MOTION) {
    await devtools.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    print('emulating prefers-reduced-motion: reduce\n');
  }

  // Collected per navigation. The listeners stay attached for the whole run and
  // write into whichever arrays are current, which is simpler than attaching
  // and detaching around every page and cannot drop an event in the gap.
  let consoleErrors: string[] = [];
  let exceptions: string[] = [];
  let failedRequests: string[] = [];
  let unauthorised = 0;

  devtools.on('Runtime.consoleAPICalled', (params) => {
    const call = params as { type?: string; args?: { value?: unknown; description?: string }[] };
    if (call.type !== 'error') return;
    const text = (call.args ?? [])
      .map((arg) => String(arg.value ?? arg.description ?? ''))
      .join(' ')
      .trim();
    consoleErrors.push(text === '' ? 'an empty console error' : text);
  });

  devtools.on('Runtime.exceptionThrown', (params) => {
    const thrown = params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
    exceptions.push(
      thrown.exceptionDetails?.exception?.description
      ?? thrown.exceptionDetails?.text
      ?? 'an exception with no description',
    );
  });

  devtools.on('Network.loadingFailed', (params) => {
    const failure = params as { errorText?: string; type?: string; canceled?: boolean };
    if (failure.canceled === true) return;
    failedRequests.push(`${failure.type ?? 'request'} failed: ${failure.errorText ?? 'no reason given'}`);
  });

  devtools.on('Network.responseReceived', (params) => {
    const received = params as { response?: { status?: number; url?: string } };
    const status = received.response?.status ?? 0;
    if (status === 401 || status === 403) {
      unauthorised += 1;
      return;
    }
    if (status >= 400) {
      failedRequests.push(`${status} from ${received.response?.url ?? 'an unnamed url'}`);
    }
  });

  for (const viewport of VIEWPORTS) {
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.width < 768,
    });

    print(`${viewport.name} ${viewport.width}x${viewport.height}`);

    for (const path of PATHS) {
      consoleErrors = [];
      exceptions = [];
      failedRequests = [];
      unauthorised = 0;

      const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
      await devtools.send('Page.navigate', { url: `${base}${path}` });
      try {
        await loaded;
      } catch {
        exceptions.push('the page never fired its load event');
      }
      // `load` only proves that the SPA shell arrived. Most runtime routes are
      // lazy chunks, so a busy production browser can still have an empty
      // React root at the old fixed settle point. Wait for meaningful route
      // copy before measuring; keep the fixed settle as a final ceiling so a
      // genuinely blank route still fails instead of hanging the audit.
      const renderDeadline = Date.now() + Math.max(SETTLE_MS, 10_000);
      let renderedText = 0;
      do {
        const probe = await devtools.send('Runtime.evaluate', {
          expression: `(document.body.innerText || '').trim().length`,
          returnByValue: true,
        }) as { result?: { value?: number } };
        renderedText = probe.result?.value ?? 0;
        if (renderedText > 80) break;
        await wait(150);
      } while (Date.now() < renderDeadline);

      const measured = await devtools.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: (document.body.innerText || '').trim().length,
          head: (document.body.innerText || '').trim().slice(0, 400)
        })`,
        returnByValue: true,
      }) as { result?: { value?: string } };

      const reading = JSON.parse(measured.result?.value ?? '{"overflow":0,"text":0,"head":""}') as {
        overflow: number;
        text: number;
        head: string;
      };

      // The landing page, as this viewport drew it, to compare the rest against.
      if (path === '/') rootHead = reading.head;

      // A path that is not a route still answers 200 here, because the catch all
      // rewrite hands every unknown URL to index.html and React draws the
      // landing page. That is the SPA working and it is also how `/docs`, which
      // this project does not have, sat in this list passing. A non-root path
      // whose text is the landing page's text has not been verified, it has been
      // redirected, and the audit says so instead of counting it.
      const isLandingInDisguise = path !== '/' && rootHead !== null && reading.head === rootHead;

      const finding: Finding = {
        path,
        viewport: viewport.name,
        consoleErrors: [...consoleErrors],
        exceptions: [...exceptions],
        failedRequests: [...failedRequests],
        unauthorised,
        horizontalOverflowPx: Math.max(0, reading.overflow),
        textLength: reading.text,
        renderedTheLandingPage: isLandingInDisguise,
        ok: consoleErrors.length === 0
          && exceptions.length === 0
          && failedRequests.length === 0
          && reading.overflow <= 0
          && reading.text > 80
          && !isLandingInDisguise,
      };
      findings.push(finding);

      const flags = [
        finding.consoleErrors.length > 0 ? `${finding.consoleErrors.length} console` : '',
        finding.exceptions.length > 0 ? `${finding.exceptions.length} thrown` : '',
        finding.failedRequests.length > 0 ? `${finding.failedRequests.length} requests` : '',
        finding.horizontalOverflowPx > 0 ? `${finding.horizontalOverflowPx}px sideways` : '',
        finding.textLength <= 80 ? `only ${finding.textLength} characters drawn` : '',
        finding.renderedTheLandingPage ? 'not a route, the catch all drew the landing page' : '',
      ].filter((flag) => flag !== '').join(', ');

      print(`  ${finding.ok ? 'ok  ' : 'FAIL'}  ${path.padEnd(18)}${flags}`);
      if (!finding.ok) {
        for (const detail of [
          ...finding.consoleErrors.map((entry) => `console: ${entry}`),
          ...finding.exceptions.map((entry) => `exception: ${entry}`),
          ...finding.failedRequests.map((entry) => `request: ${entry}`),
        ].slice(0, 4)) print(`       ${detail}`);
      }
    }
    print('');
  }
} finally {
  devtools?.close();
  browser.kill();
  // Chrome does not release the profile directory the instant it is killed, and
  // on Windows removing it too soon fails with EPERM. The directory is in the
  // system temp folder and the run is over, so a failure to tidy is not a
  // failure of the audit and must not be reported as one.
  await wait(500);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    process.stderr.write(`could not remove the temporary profile at ${profile}\n`);
  }
}

const failures = findings.filter((finding) => !finding.ok);
const report = {
  recorded: new Date().toISOString().slice(0, 10),
  base,
  reducedMotion: REDUCED_MOTION,
  viewports: VIEWPORTS.map((viewport) => `${viewport.name} ${viewport.width}x${viewport.height}`),
  routes: PATHS.length,
  checks: findings.length,
  clean: failures.length === 0,
  totals: {
    consoleErrors: findings.reduce((sum, finding) => sum + finding.consoleErrors.length, 0),
    exceptions: findings.reduce((sum, finding) => sum + finding.exceptions.length, 0),
    failedRequests: findings.reduce((sum, finding) => sum + finding.failedRequests.length, 0),
    routesScrollingSideways: findings.filter((finding) => finding.horizontalOverflowPx > 0).length,
    pathsThatAreNotRoutes: findings.filter((finding) => finding.renderedTheLandingPage).length,
    unauthorisedResponses: findings.reduce((sum, finding) => sum + finding.unauthorised, 0),
  },
  findings,
};

mkdirSync(OUT_DIR, { recursive: true });
const outFile = REDUCED_MOTION ? 'routes-reduced-motion.json' : 'routes.json';
writeFileSync(`${OUT_DIR}/${outFile}`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print(`${findings.length} checks over ${PATHS.length} routes at ${VIEWPORTS.length} viewports`);
print(`console errors ${report.totals.consoleErrors}, exceptions ${report.totals.exceptions}, failed requests ${report.totals.failedRequests}`);
print(`routes scrolling sideways ${report.totals.routesScrollingSideways}`);
print(`unauthorised reads, which are the deployment refusing correctly: ${report.totals.unauthorisedResponses}`);
print('');
print(`ROUTE_AUDIT_CLEAN: ${report.clean}`);
print(`artifacts/route-audit/${outFile} written.`);

if (!report.clean) process.exit(1);
