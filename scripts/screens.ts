import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

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

const CHROME_CANDIDATES = [
  process.env['CHROME'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const OUT_DIR = fileURLToPath(new URL('../artifacts/screens', import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate;
  }
  fail('no Chrome found. Set CHROME to the executable and run this again.');
}

/** A port nothing is listening on, handed straight to Chrome. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('the probe socket reported no port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * The debugger endpoint, once Chrome has one.
 *
 * Chrome opens its port some way into start up, so the first few requests are
 * expected to be refused. That is polled rather than slept through, because a
 * sleep long enough to be safe on a cold start is a sleep wasted on every warm
 * one.
 */
async function debuggerUrl(port: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body = await response.json() as { webSocketDebuggerUrl?: unknown };
      if (typeof body.webSocketDebuggerUrl === 'string') return body.webSocketDebuggerUrl;
    } catch {
      // Not up yet. The deadline is the only thing that ends this loop.
    }
    await wait(120);
  }
  fail('Chrome never opened its debugging port');
}

interface Message {
  readonly id?: number;
  readonly method?: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

/**
 * One command channel to one page.
 *
 * The protocol is request and response over a single socket, with events
 * arriving on the same socket unsolicited, so this is a small correlation table
 * and a list of people waiting for an event. Everything a caller needs is
 * `send` and `once`.
 */
class Devtools {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private readonly waiting: { method: string; resolve: () => void }[] = [];
  private sequence = 0;
  private sessionId: string | undefined;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message;

      if (typeof message.id === 'number') {
        const seat = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (seat === undefined) return;
        if (message.error !== undefined) {
          seat.reject(new Error(message.error.message ?? 'the browser refused a command'));
        } else {
          seat.resolve(message.result);
        }
        return;
      }

      if (typeof message.method !== 'string') return;
      for (let index = this.waiting.length - 1; index >= 0; index -= 1) {
        const seat = this.waiting[index];
        if (seat !== undefined && seat.method === message.method) {
          this.waiting.splice(index, 1);
          seat.resolve();
        }
      }
    });
  }

  static open(url: string): Promise<Devtools> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener('open', () => { resolve(new Devtools(socket)); }, { once: true });
      socket.addEventListener('error', () => {
        reject(new Error(`could not connect to ${url}`));
      }, { once: true });
    });
  }

  /** Attach to a fresh tab, and address every later command to it. */
  async attach(): Promise<void> {
    const created = await this.send('Target.createTarget', { url: 'about:blank' }) as {
      targetId: string;
    };
    const attached = await this.send('Target.attachToTarget', {
      targetId: created.targetId,
      flatten: true,
    }) as { sessionId: string };
    this.sessionId = attached.sessionId;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.sequence += 1;
    const id = this.sequence;
    const frame: Record<string, unknown> = { id, method, params };
    if (this.sessionId !== undefined) frame['sessionId'] = this.sessionId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(frame));
    });
  }

  /**
   * Resolve when the named event next arrives, or reject on the deadline.
   *
   * A page that never fires its load event has to end the run rather than hang
   * it, because this is something a build is allowed to depend on.
   */
  once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const seat = { method, resolve: () => { clearTimeout(timer); resolve(); } };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(seat);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new Error(`${method} did not arrive within ${timeoutMs} ms`));
      }, timeoutMs);
      this.waiting.push(seat);
    });
  }

  close(): void {
    this.socket.close();
  }
}

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

mkdirSync(OUT_DIR, { recursive: true });

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

  for (const shot of SHOTS) {
    const target = join(OUT_DIR, shot.file);

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
    await wait(SETTLE_MS);

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
    ? `\n${SHOTS.length} captures, all checked\n`
    : `\n${failures} of ${SHOTS.length} captures failed their checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
