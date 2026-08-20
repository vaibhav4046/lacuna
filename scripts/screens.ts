import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * Recaptures artifacts/screens from the running server.
 *
 *   npm run serve          # in another terminal, on :3014
 *   npm run screens
 *
 * The set is evidence, so it has to be reproducible by someone who is not me,
 * and it has to be checkable without a person looking at it. Both of those rule
 * out driving a browser by hand. What is left is Chrome's own remote debugging
 * protocol, which is why this file talks to a WebSocket rather than to a
 * screenshot flag: the flag cannot set a colour scheme, cannot capture past the
 * fold, and cannot tell you afterwards whether what it wrote was a page or an
 * empty rectangle. All three of those are things this set has to get right.
 *
 * Nothing is installed for this. Node 22 and later ship a global WebSocket and
 * a global fetch, Chrome ships the protocol, and the repository stays at five
 * devDependencies.
 *
 * Every capture is read back off disk before it is reported: the PNG header is
 * parsed for the real dimensions, the first pixel is decoded to confirm the
 * ground is the ground, and the compressed size is checked against the area so
 * a capture of a blank page cannot pass as a capture of a page. A shot that
 * fails any of those exits non-zero rather than printing a filename.
 */

/** What the browser is told the reader prefers, which the page ignores. */
type Preference = 'light' | 'dark';

interface Shot {
  /** File name under artifacts/screens. */
  readonly file: string;
  /** Path and query on the server, which is also what the README prints. */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly prefers: Preference;
  /** True to capture the whole document rather than the first screen of it. */
  readonly whole: boolean;
  /**
   * Extra settling for a screen that fills after load.
   *
   * The recorded site is server rendered and is finished when the load event
   * fires. The deployed application is not: it mounts, asks the API, and draws
   * when the answers arrive, so a capture taken at load is a capture of an
   * empty frame. The density check would catch that, which is exactly why the
   * wait belongs here rather than in a hope.
   */
  readonly settleMs?: number;
}

const SHOTS: readonly Shot[] = [
  { file: 'home-1920x1080.png', url: '/', width: 1_920, height: 1_080, prefers: 'dark', whole: false },
  { file: 'home-3840x2160.png', url: '/', width: 3_840, height: 2_160, prefers: 'dark', whole: false },
  { file: 'home-375x812.png', url: '/', width: 375, height: 812, prefers: 'dark', whole: false },
  {
    file: 'home-light-preference-1920x1080.png',
    url: '/',
    width: 1_920, height: 1_080, prefers: 'light', whole: false,
  },
  { file: 'bench-1920x1080.png', url: '/bench', width: 1_920, height: 1_080, prefers: 'dark', whole: false },
  { file: 'bench-fullpage.png', url: '/bench', width: 1_920, height: 1_080, prefers: 'dark', whole: true },
  { file: 'memory-1920x1080.png', url: '/memory', width: 1_920, height: 1_080, prefers: 'dark', whole: false },
  {
    file: 'memory-contradicted-fullpage.png',
    url: '/memory?filter=contradicted',
    width: 1_920, height: 1_080, prefers: 'dark', whole: true,
  },
  { file: 'health-fullpage.png', url: '/health', width: 1_920, height: 1_080, prefers: 'dark', whole: true },
  { file: 'hydradb-fullpage.png', url: '/hydradb', width: 1_920, height: 1_080, prefers: 'dark', whole: true },
  { file: 'interface-fullpage.png', url: '/interface', width: 1_920, height: 1_080, prefers: 'dark', whole: true },
  { file: 'voice-fullpage.png', url: '/voice', width: 1_920, height: 1_080, prefers: 'dark', whole: true },
  {
    file: 'answer-revised-1920x1080.png',
    url: '/ask?subject=Bellwether&predicate=beta_partner',
    width: 1_920, height: 1_080, prefers: 'dark', whole: false,
  },
  {
    file: 'answer-revised-fullpage.png',
    url: '/ask?subject=Bellwether&predicate=beta_partner',
    width: 1_920, height: 1_080, prefers: 'dark', whole: true,
  },
  {
    file: 'answer-multihop-fullpage.png',
    url: '/ask?subject=replay-queue&predicate=contact&via=vendor',
    width: 1_920, height: 1_080, prefers: 'dark', whole: true,
  },
  {
    file: 'answer-never-stated-1920x1080.png',
    url: '/ask?subject=Meridian&predicate=migration_window',
    width: 1_920, height: 1_080, prefers: 'dark', whole: false,
  },
  {
    file: 'blast-fullpage.png',
    url: '/blast?package=pact-check',
    width: 1_920, height: 1_080, prefers: 'dark', whole: true,
  },
];

/**
 * Mean channel value the first pixel has to stay under, whatever was preferred.
 *
 * There is one ground and it is black, so this is not a check that the right
 * palette was picked: it is a check that no palette was picked at all. Both
 * preferences are emulated and both have to come back under this number, which
 * is what makes the light capture evidence rather than decoration. The ceiling
 * sits far above the ground itself so a token can be tuned without editing a
 * threshold.
 */
const GROUND_CEILING = 90;

/**
 * Compressed bytes per pixel a capture has to reach.
 *
 * A page of text compresses to roughly 0.1 bytes per pixel. A single flat
 * colour compresses to about four orders of magnitude less than that, so this
 * threshold sits twenty times below anything real and a thousand times above a
 * blank rectangle. It exists to catch a navigation that failed silently, not to
 * grade the image.
 */
const MIN_BYTES_PER_PIXEL = 0.005;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const LOAD_TIMEOUT_MS = 20_000;

/** After load, for the last of the layout to settle before the pixels are read. */
const SETTLE_MS = 300;


const OUT_DIR = fileURLToPath(new URL('../artifacts/screens', import.meta.url));
const LIVE_DIR = fileURLToPath(new URL('../artifacts/screens/live', import.meta.url));



interface Reading {
  readonly width: number;
  readonly height: number;
  /** Red, green and blue of the top left pixel, straight out of the stream. */
  readonly corner: readonly [number, number, number];
  readonly bytes: number;
}

/**
 * Read a PNG far enough to say what it is.
 *
 * Only the first pixel is decoded, and it can be: whatever filter the encoder
 * chose for the first scanline, every one of them subtracts a neighbour that
 * does not exist on the first row and first column, so the stored bytes are the
 * pixel. That is enough to tell a light page from a dark one, which is the
 * question, and it avoids carrying a PNG decoder in a repository that has no
 * dependencies.
 */
function readPng(path: string): Reading {
  const file = readFileSync(path);
  if (!file.subarray(0, 8).equals(PNG_MAGIC)) {
    throw new Error(`${path} does not start with a PNG signature`);
  }

  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  const depth = file.readUInt8(24);
  const colourType = file.readUInt8(25);
  if (depth !== 8) throw new Error(`${path} is ${depth} bits per channel, not 8`);
  if (colourType !== 2 && colourType !== 6) {
    throw new Error(`${path} has colour type ${colourType}, which is not RGB or RGBA`);
  }

  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= file.length) {
    const length = file.readUInt32BE(offset);
    const type = file.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') parts.push(file.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (parts.length === 0) throw new Error(`${path} carries no image data`);

  const raw = inflateSync(Buffer.concat(parts));
  if (raw.length < 4) throw new Error(`${path} decompressed to ${raw.length} bytes`);

  return {
    width,
    height,
    corner: [raw[1] ?? 0, raw[2] ?? 0, raw[3] ?? 0],
    bytes: file.length,
  };
}

/** Everything that has to be true of a capture before it is allowed to count. */
function check(shot: Shot, reading: Reading): void {
  const mean = (reading.corner[0] + reading.corner[1] + reading.corner[2]) / 3;

  if (reading.width !== shot.width) {
    throw new Error(`${shot.file} is ${reading.width} wide, asked for ${shot.width}`);
  }
  if (shot.whole) {
    if (reading.height < shot.height) {
      throw new Error(
        `${shot.file} is ${reading.height} tall, shorter than the ${shot.height} viewport`,
      );
    }
  } else if (reading.height !== shot.height) {
    throw new Error(`${shot.file} is ${reading.height} tall, asked for ${shot.height}`);
  }

  if (mean > GROUND_CEILING) {
    throw new Error(
      `${shot.file} was captured preferring ${shot.prefers} and came back at ${mean.toFixed(0)}, `
      + `over the ${GROUND_CEILING} ceiling the one ground has to stay under`,
    );
  }

  const density = reading.bytes / (reading.width * reading.height);
  if (density < MIN_BYTES_PER_PIXEL) {
    throw new Error(
      `${shot.file} compressed to ${density.toFixed(4)} bytes per pixel, which is a blank page`,
    );
  }
}


/**
 * The deployed application, captured from outside it.
 *
 * Different pages from the set above and on purpose: those are the recorded
 * site this URL used to serve, and these are the product answering. Every one
 * of them reaches HydraDB Cloud while the shutter is open, which is why they
 * settle for seconds rather than milliseconds.
 */
const LIVE_SHOTS: readonly Shot[] = [
  { file: 'live-landing-1920x1080.png', url: '/', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 2_500 },
  { file: 'live-landing-375x812.png', url: '/', width: 375, height: 812, prefers: 'dark', whole: false, settleMs: 2_500 },
  { file: 'live-judge-fullpage.png', url: '/judge', width: 1_440, height: 1_000, prefers: 'dark', whole: true, settleMs: 22_000 },
  { file: 'live-judge-1920x1080.png', url: '/judge', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 22_000 },
  { file: 'live-judge-375x812.png', url: '/judge', width: 375, height: 812, prefers: 'dark', whole: false, settleMs: 22_000 },
  { file: 'live-dashboard-1920x1080.png', url: '/explore/dash', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
  { file: 'live-memory-fullpage.png', url: '/explore/memory', width: 1_440, height: 1_000, prefers: 'dark', whole: true, settleMs: 4_000 },
  { file: 'live-timeline-1920x1080.png', url: '/explore/timeline', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
  { file: 'live-graph-1920x1080.png', url: '/explore/graph', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
  { file: 'live-health-1920x1080.png', url: '/explore/health', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
  { file: 'live-evaluations-1920x1080.png', url: '/explore/evals', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
  { file: 'live-hydradb-1920x1080.png', url: '/explore/hydra', width: 1_920, height: 1_080, prefers: 'dark', whole: false, settleMs: 4_000 },
];

/** `--live` captures the deployed application; the default captures the recorded site. */
const LIVE = process.argv.includes('--live');
const SET: readonly Shot[] = LIVE ? LIVE_SHOTS : SHOTS;
const TARGET_DIR = LIVE ? LIVE_DIR : OUT_DIR;

const base = (process.argv[2] ?? 'http://127.0.0.1:3014').replace(/\/$/, '');

// Refuse to photograph a dead server. Without this, every navigation lands on
// Chrome's own connection-error page, and the dark variant of that page is
// black enough and busy enough to pass both the ground and the density checks.
// Observed on 2026-08-17: twelve identical false passes at 21,883 bytes each,
// and only the light-preference capture honest enough to fail. A capture run
// is evidence, and evidence of the wrong page is worse than no run at all.
try {
  const probe = await fetch(`${base}/`, { signal: AbortSignal.timeout(3_000) });
  if (!probe.ok) fail(`the server at ${base} answered ${probe.status}; not capturing that`);
} catch {
  fail(`nothing answering at ${base}. Start it first: npm run serve`);
}

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-screens-'));

mkdirSync(TARGET_DIR, { recursive: true });

process.stdout.write(`chrome  ${chrome}\nserver  ${base}\nout     ${OUT_DIR}\n\n`);

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

  process.stdout.write('file                                 size        prefers  bytes    px\n');

  for (const shot of SET) {
    const target = join(TARGET_DIR, shot.file);

    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await devtools.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-color-scheme', value: shot.prefers }],
    });

    const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
    await devtools.send('Page.navigate', { url: `${base}${shot.url}` });
    await loaded;
    await wait(shot.settleMs ?? SETTLE_MS);

    const capture = await devtools.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: shot.whole,
      fromSurface: true,
    }) as { data: string };

    writeFileSync(target, Buffer.from(capture.data, 'base64'));

    try {
      const reading = readPng(target);
      check(shot, reading);
      const size = `${reading.width}x${reading.height}`;
      const density = (reading.bytes / (reading.width * reading.height)).toFixed(3);
      process.stdout.write(
        `${shot.file.padEnd(37)}${size.padEnd(12)}${shot.prefers.padEnd(9)}`
        + `${String(reading.bytes).padStart(8)}${density.padStart(7)}\n`,
      );
    } catch (error) {
      failures += 1;
      process.stdout.write(`${shot.file.padEnd(37)}${(error as Error).message}\n`);
    }
  }
} finally {
  devtools?.close();
  browser.kill();
  await wait(200);
  // Chrome on Windows can hold the profile directory open for a moment after
  // the process is killed; retry, and if it still will not go, leave the temp
  // directory behind rather than failing a run whose captures all validated.
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    process.stdout.write(`profile directory left behind: ${profile}\n`);
  }
}

process.stdout.write(
  failures === 0
    ? `\n${SET.length} captures, all checked\n`
    : `\n${failures} of ${SET.length} captures failed their checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
