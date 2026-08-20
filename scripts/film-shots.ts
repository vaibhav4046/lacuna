import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * The stills the film needs, captured from the deployment rather than a mock.
 *
 * `scripts/screens.ts` captures the local snapshot server, which is a different
 * surface with different routes. These are the live screens, and two of them
 * did not exist when the film was last rendered: the extractor, and the walk of
 * HydraDB's own graph. The existing `live-hydradb` still is of the panel before
 * the walk was added, so it is retaken here rather than kept.
 *
 * Each shot scrolls to the thing it is about before it fires, because the
 * panels that matter are below the fold on a 1080 viewport and a still of the
 * top of the page would be a still of nothing.
 *
 *   npx tsx scripts/film-shots.ts
 */

const BASE = 'https://lacuna-five.vercel.app';
const OUT_DIR = 'video/hyperframes/assets/screens';
const LOAD_TIMEOUT_MS = 30_000;

interface Shot {
  readonly file: string;
  readonly url: string;
  /** Runs after load. Scrolls the panel this shot is about into frame. */
  readonly focus: string;
  /** Extra settle after the focus script, for a panel that is still fetching. */
  readonly settleMs: number;
}

/**
 * Scrolls so the element whose text contains `needle` sits `top` pixels from
 * the top of the viewport. Returns whether it found one, so a silent miss
 * becomes a loud failure rather than a still of the wrong thing.
 */
function scrollTo(needle: string, top = 90): string {
  return `(() => {
    const wanted = ${JSON.stringify(needle)};
    const all = [...document.querySelectorAll('div, section, span, h1, h2, p')];
    const hit = all.reverse().find((el) => (el.textContent || '').includes(wanted));
    if (!hit) return 'MISS';
    const y = hit.getBoundingClientRect().top + window.scrollY - ${top};
    window.scrollTo({ top: Math.max(0, y), behavior: 'instant' });
    return 'OK';
  })()`;
}

/**
 * Fires a real agent run and waits for the verdict.
 *
 * A still of this screen before the run is a still of a text box, which is
 * exactly the empty-feature shot the film exists to avoid. So the shot drives
 * it: types the task, clicks RUN, and returns only once the reviewer's verdict
 * is on the page. It reports MISS rather than settling for the empty state,
 * because a photograph of the wrong moment is worse than a failed run.
 */
function runAgent(task: string): string {
  return `(async () => {
    const ta = document.querySelector('textarea');
    if (!ta) return 'MISS';
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(task)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    const run = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'RUN TASK');
    if (!run) return 'MISS';
    run.click();
    for (let waited = 0; waited < 40_000; waited += 500) {
      await new Promise((r) => setTimeout(r, 500));
      if (document.body.innerText.includes('NO AUTHORITATIVE WRITE')) {
        const marker = [...document.querySelectorAll('span')]
          .find((el) => (el.textContent || '').includes('NO AUTHORITATIVE WRITE'));
        marker?.closest('section')?.scrollIntoView({ block: 'start', behavior: 'instant' });
        window.scrollBy({ top: -82, behavior: 'instant' });
        return 'OK';
      }
    }
    return 'MISS';
  })()`;
}

/**
 * Types a question and waits for the reading to appear.
 *
 * The screen's whole point is that a sentence gets read into a subject and a
 * predicate before anything is resolved, so a still of the empty box would show
 * none of it. This waits for READ AS specifically rather than for any text,
 * because that line is what proves the question was understood.
 */
function askSentence(question: string, placeholderStartsWith: string): string {
  return `(async () => {
    const box = [...document.querySelectorAll('input')]
      .find((i) => (i.placeholder || '').startsWith(${JSON.stringify(placeholderStartsWith)}));
    if (!box) return 'MISS';
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(box, ${JSON.stringify(question)});
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    for (let waited = 0; waited < 30_000; waited += 500) {
      await new Promise((r) => setTimeout(r, 500));
      if (document.body.innerText.includes('READ AS')) return 'OK';
    }
    return 'MISS';
  })()`;
}

const ALL_SHOTS: readonly Shot[] = [
  {
    file: 'live-dashboard-v8-1920x1080.png',
    url: '/explore/dash',
    focus: scrollTo('MEMORY CONTROL ROOM', 88),
    settleMs: 6_000,
  },
  {
    file: 'live-graph-v8-1920x1080.png',
    url: '/explore/graph',
    focus: scrollTo('MEMORY FIELD OVERVIEW', 88),
    settleMs: 6_000,
  },
  {
    file: 'live-proof-graph-v8-1920x1080.png',
    url: '/explore/hydra',
    focus: scrollTo('PROOF GRAPH · EXACT PROVENANCE', 88),
    settleMs: 9_000,
  },
  {
    file: 'live-agent-recommendations-v8-1920x1080.png',
    url: '/explore/agents',
    focus: scrollTo('SUGGESTED FROM THIS MEMORY', 88),
    settleMs: 6_000,
  },
  {
    file: 'live-work-v8-1920x1080.png',
    url: '/explore/work',
    focus: scrollTo('SCHEDULES · DAILY IS THE SUPPORTED CADENCE', 88),
    settleMs: 6_000,
  },
  {
    file: 'live-tools-v8-1920x1080.png',
    url: '/explore/tools',
    focus: scrollTo('REMOTE MCP', 88),
    settleMs: 6_000,
  },
  {
    file: 'live-voice-v8-1920x1080.png',
    url: '/explore/voice',
    focus: scrollTo('VOICE · READY', 88),
    settleMs: 3_000,
  },
  {
    // The top of the same screen, for the scene that talks about what the
    // managed service holds rather than about the walk.
    file: 'live-hydradb-top-1920x1080.png',
    url: '/explore/hydra',
    focus: scrollTo('HYDRADB', 0),
    settleMs: 5_000,
  },
  {
    file: 'live-hydradb-1920x1080.png',
    url: '/explore/hydra',
    focus: scrollTo('THE SAME GRAPH, WALKED FOR ONE SUBJECT'),
    // The walk is a real traversal against the managed service and takes about
    // three seconds, so this waits for the rows rather than the page.
    settleMs: 9_000,
  },
  {
    file: 'live-extract-1920x1080.png',
    url: '/explore/memory',
    focus: scrollTo('BEFORE THE GRAPH'),
    settleMs: 4_000,
  },
  {
    // A run that actually ran, over the corpus anybody can read. Two model
    // calls happen while the shutter is open, which is why it settles longest.
    file: 'live-agents-1920x1080.png',
    url: '/explore/agents',
    focus: runAgent('What does trace-collector depend on, and who owns it?'),
    settleMs: 2_000,
  },
  {
    // A question typed as a sentence, showing the reading beside the answer.
    // Captured after it resolves, because a photograph of the empty box would
    // show none of what this screen is for.
    file: 'live-ask-1920x1080.png',
    url: '/explore/ask',
    focus: askSentence('who is the runbook owner for billing-gate?', 'Ask in a sentence'),
    settleMs: 2_500,
  },
];

const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlyFile = onlyArg?.slice('--only='.length);
const SET: readonly Shot[] = onlyFile === undefined
  ? ALL_SHOTS
  : ALL_SHOTS.filter((shot) => shot.file === onlyFile);

if (onlyFile !== undefined && SET.length === 0) {
  throw new Error(`Unknown shot: ${onlyFile}`);
}

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-film-'));

mkdirSync(OUT_DIR, { recursive: true });
process.stdout.write(`chrome  ${chrome}\nsite    ${BASE}\nout     ${OUT_DIR}\n\n`);

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

let devtools: Devtools | undefined;
let failures = 0;

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');

  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 1_920,
    height: 1_080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await devtools.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });

  for (const shot of SET) {
    const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
    await devtools.send('Page.navigate', { url: `${BASE}${shot.url}` });
    await loaded;
    await wait(shot.settleMs);

    // `awaitPromise` because a focus script may be async: the agents shot has
    // to fire a run and wait for its verdict, and without this the evaluate
    // returns the pending promise itself, which is never 'OK'.
    const focused = await devtools.send('Runtime.evaluate', {
      expression: shot.focus,
      returnByValue: true,
      awaitPromise: true,
    }) as { result?: { value?: string } };

    if (focused.result?.value !== 'OK') {
      process.stdout.write(`${shot.file.padEnd(34)}FAILED: the panel it frames was not on the page\n`);
      failures += 1;
      continue;
    }
    await wait(600);

    const capture = await devtools.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    }) as { data: string };

    const bytes = Buffer.from(capture.data, 'base64');
    writeFileSync(join(OUT_DIR, shot.file), bytes);
    process.stdout.write(`${shot.file.padEnd(34)}${String(bytes.length).padStart(8)} bytes  ${shot.url}\n`);
  }
} finally {
  devtools?.close();
  browser.kill();
}

if (failures > 0) fail(`\n${failures} shot(s) did not capture what they were aimed at.`);
process.stdout.write('\nall shots captured.\n');
