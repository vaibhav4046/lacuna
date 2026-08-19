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
 * Two viewports, a laptop and a phone, since half the failures only exist at
 * one of them.
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

const PATHS = [
  '/',
  '/judge',
  '/docs',
  '/signin',
  '/signup',
  ...APP_ROUTES.map((route) => `/demo/${route}`),
];

const VIEWPORTS = [
  { name: 'laptop', width: 1_440, height: 900 },
  { name: 'phone', width: 375, height: 812 },
] as const;

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

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  await devtools.send('Network.enable');

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
      await wait(SETTLE_MS);

      const measured = await devtools.send('Runtime.evaluate', {
        expression: `JSON.stringify({
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          text: (document.body.innerText || '').trim().length
        })`,
        returnByValue: true,
      }) as { result?: { value?: string } };

      const reading = JSON.parse(measured.result?.value ?? '{"overflow":0,"text":0}') as {
        overflow: number;
        text: number;
      };

      const finding: Finding = {
        path,
        viewport: viewport.name,
        consoleErrors: [...consoleErrors],
        exceptions: [...exceptions],
        failedRequests: [...failedRequests],
        unauthorised,
        horizontalOverflowPx: Math.max(0, reading.overflow),
        textLength: reading.text,
        ok: consoleErrors.length === 0
          && exceptions.length === 0
          && failedRequests.length === 0
          && reading.overflow <= 0
          && reading.text > 80,
      };
      findings.push(finding);

      const flags = [
        finding.consoleErrors.length > 0 ? `${finding.consoleErrors.length} console` : '',
        finding.exceptions.length > 0 ? `${finding.exceptions.length} thrown` : '',
        finding.failedRequests.length > 0 ? `${finding.failedRequests.length} requests` : '',
        finding.horizontalOverflowPx > 0 ? `${finding.horizontalOverflowPx}px sideways` : '',
        finding.textLength <= 80 ? `only ${finding.textLength} characters drawn` : '',
      ].filter((flag) => flag !== '').join(', ');

      print(`  ${finding.ok ? 'ok  ' : 'FAIL'}  ${path.padEnd(18)}${flags}`);
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
  viewports: VIEWPORTS.map((viewport) => `${viewport.name} ${viewport.width}x${viewport.height}`),
  routes: PATHS.length,
  checks: findings.length,
  clean: failures.length === 0,
  totals: {
    consoleErrors: findings.reduce((sum, finding) => sum + finding.consoleErrors.length, 0),
    exceptions: findings.reduce((sum, finding) => sum + finding.exceptions.length, 0),
    failedRequests: findings.reduce((sum, finding) => sum + finding.failedRequests.length, 0),
    routesScrollingSideways: findings.filter((finding) => finding.horizontalOverflowPx > 0).length,
    unauthorisedResponses: findings.reduce((sum, finding) => sum + finding.unauthorised, 0),
  },
  findings,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/routes.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print(`${findings.length} checks over ${PATHS.length} routes at ${VIEWPORTS.length} viewports`);
print(`console errors ${report.totals.consoleErrors}, exceptions ${report.totals.exceptions}, failed requests ${report.totals.failedRequests}`);
print(`routes scrolling sideways ${report.totals.routesScrollingSideways}`);
print(`unauthorised reads, which are the deployment refusing correctly: ${report.totals.unauthorisedResponses}`);
print('');
print(`ROUTE_AUDIT_CLEAN: ${report.clean}`);
print('artifacts/route-audit/routes.json written.');

if (!report.clean) process.exit(1);
