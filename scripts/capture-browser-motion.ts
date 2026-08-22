import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { writeFile as writeFileAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';

import {
  CAPTURE_FPS,
  CAPTURE_HEIGHT,
  CAPTURE_WIDTH,
  actionForMetadata,
  frameMetrics,
  jpegDimensions,
  markerForMetadata,
  parseBrowserMotionSpec,
  resolveTypeValue,
  sanitizedSourceUrl,
  sha256Hex,
  type CaptureAction,
  type MarkerSpec,
  type SourceFrame,
} from './lib/browser-motion.js';
import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * Record actual moving browser pixels through Chrome's acknowledged CDP
 * screencast stream, then normalize the real frames to 1920x1080/30 fps.
 *
 *   npm run capture:motion -- --spec scripts/shots/landing-motion-smoke.json
 *   npm run capture:motion -- --spec shot.json --output C:/temp/shot.mp4
 *
 * The shot JSON is declarative. It can wait on exact DOM markers, scroll,
 * click, and type with real browser input events. Typed values and exact marker
 * values never enter logs or metadata. Password fields are refused, common
 * secret fields are always masked, and URL credentials/sensitive query keys
 * are rejected by the parser.
 */

const LOAD_TIMEOUT_MS = 30_000;
const DEFAULT_MASK_SELECTORS = [
  'input[type="password"]',
  '[autocomplete="current-password"]',
  '[autocomplete="new-password"]',
  '[data-secret]',
  '[data-private]',
  '[name*="token" i]',
  '[name*="secret" i]',
  '[name*="password" i]',
] as const;

interface CliOptions {
  readonly specPath: string;
  readonly outputOverride?: string;
  readonly metadataOverride?: string;
  readonly force: boolean;
  readonly keepFrames: boolean;
}

interface ScreencastEvent {
  readonly data?: string;
  readonly sessionId?: number;
  readonly metadata?: {
    readonly timestamp?: number;
    readonly deviceWidth?: number;
    readonly deviceHeight?: number;
  };
}

interface NetworkRequestEvent {
  readonly requestId?: string;
  readonly request?: { readonly url?: string; readonly method?: string };
}

interface NetworkResponseEvent {
  readonly requestId?: string;
  readonly response?: { readonly url?: string; readonly status?: number };
}

interface NetworkFailureEvent {
  readonly requestId?: string;
  readonly errorText?: string;
  readonly canceled?: boolean;
}

interface ApiResponseRecord {
  readonly method: string;
  readonly path: string;
  readonly status: number;
}

interface ApiFailureRecord {
  readonly method: string;
  readonly path: string;
  readonly error: string;
  readonly canceled: boolean;
}

interface ActionResult {
  readonly index: number;
  readonly action: Record<string, unknown>;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly ok: true;
}

interface VideoProbe {
  readonly codec: string;
  readonly width: number;
  readonly height: number;
  readonly pixelFormat: string;
  readonly frameRate: string;
  readonly frameCount: number;
  readonly durationSeconds: number;
  readonly bytes: number;
}

function parseCli(argv: readonly string[]): CliOptions {
  let specPath: string | undefined;
  let outputOverride: string | undefined;
  let metadataOverride: string | undefined;
  let force = false;
  let keepFrames = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--force') force = true;
    else if (arg === '--keep-frames') keepFrames = true;
    else if (arg === '--spec') specPath = argv[index += 1];
    else if (arg?.startsWith('--spec=')) specPath = arg.slice('--spec='.length);
    else if (arg === '--output') outputOverride = argv[index += 1];
    else if (arg?.startsWith('--output=')) outputOverride = arg.slice('--output='.length);
    else if (arg === '--metadata') metadataOverride = argv[index += 1];
    else if (arg?.startsWith('--metadata=')) metadataOverride = arg.slice('--metadata='.length);
    else if (arg !== undefined && !arg.startsWith('-') && specPath === undefined) specPath = arg;
    else throw new Error(`unknown argument: ${arg ?? '(missing value)'}`);
  }
  if (specPath === undefined || specPath === '') throw new Error('pass --spec <shot.json>');
  return {
    specPath,
    force,
    keepFrames,
    ...(outputOverride === undefined ? {} : { outputOverride }),
    ...(metadataOverride === undefined ? {} : { metadataOverride }),
  };
}

function markerExpression(marker: MarkerSpec): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(marker.selector)});
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || '1') > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const stateMatches = ${JSON.stringify(marker.state)} === 'hidden'
      ? !visible(element)
      : ${JSON.stringify(marker.state)} === 'attached' ? element !== null : visible(element);
    if (!stateMatches) return false;
    if (!element) return true;
    const text = (element.textContent || '').trim();
    if (${JSON.stringify(marker.textEquals ?? null)} !== null && text !== ${JSON.stringify(marker.textEquals ?? null)}) return false;
    if (${JSON.stringify(marker.textIncludes ?? null)} !== null && !text.includes(${JSON.stringify(marker.textIncludes ?? null)})) return false;
    const attribute = ${JSON.stringify(marker.attribute ?? null)};
    if (attribute !== null && element.getAttribute(attribute.name) !== attribute.equals) return false;
    return true;
  })()`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolvePromise(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function sendCommand<T = unknown>(
  devtools: Devtools,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000,
): Promise<T> {
  return withTimeout(devtools.send(method, params) as Promise<T>, timeoutMs, method);
}

async function evaluateValue<T>(
  devtools: Devtools,
  expression: string,
  awaitPromise = false,
  timeoutMs = 10_000,
): Promise<T> {
  const response = await sendCommand<{
    result?: { value?: T; subtype?: string; description?: string };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>(devtools, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  }, timeoutMs);
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'browser evaluation failed');
  }
  return response.result?.value as T;
}

async function waitForMarker(devtools: Devtools, marker: MarkerSpec): Promise<void> {
  const deadline = Date.now() + marker.timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluateValue<boolean>(devtools, markerExpression(marker))) return;
    await wait(50);
  }
  throw new Error(`selector ${marker.selector} did not reach ${marker.state} within ${marker.timeoutMs} ms`);
}

async function installPrivacyMasks(devtools: Devtools, maskSelectors: readonly string[]): Promise<void> {
  const selectors = [...new Set([...DEFAULT_MASK_SELECTORS, ...maskSelectors])];
  const installed = await evaluateValue<string>(devtools, `(() => {
    const selectors = ${JSON.stringify(selectors)};
    for (const selector of selectors) {
      try { document.querySelector(selector); } catch { return 'INVALID'; }
    }
    const id = 'lacuna-capture-privacy-mask';
    document.getElementById(id)?.remove();
    const style = document.createElement('style');
    style.id = id;
    style.textContent = ${JSON.stringify(`${selectors.join(',\n')} { filter: blur(18px) !important; color: transparent !important; text-shadow: none !important; }`)};
    document.head.append(style);
    return 'OK';
  })()`);
  if (installed !== 'OK') throw new Error('one or more privacy mask selectors are invalid');
}

async function scrollAction(devtools: Devtools, action: Extract<CaptureAction, { type: 'scroll' }>): Promise<void> {
  const result = await evaluateValue<string>(devtools, `(async () => {
    const duration = ${action.durationMs};
    const startX = scrollX;
    const startY = scrollY;
    let targetX = ${action.x ?? 'startX'};
    let targetY = ${action.y ?? 'startY'};
    const selector = ${JSON.stringify(action.selector ?? null)};
    if (selector !== null) {
      const element = document.querySelector(selector);
      if (!element) return 'MISS';
      const rect = element.getBoundingClientRect();
      const absoluteTop = rect.top + scrollY;
      const align = ${JSON.stringify(action.align ?? 'center')};
      const aligned = align === 'start'
        ? absoluteTop
        : align === 'end'
          ? absoluteTop - innerHeight + rect.height
          : absoluteTop - (innerHeight - rect.height) / 2;
      targetY = aligned + ${action.offsetPx};
    } else {
      targetX = targetX + ${action.offsetPx};
      targetY = targetY + ${action.offsetPx};
    }
    targetX = Math.max(0, Math.min(targetX, Math.max(0, document.documentElement.scrollWidth - innerWidth)));
    targetY = Math.max(0, Math.min(targetY, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
    const easing = ${JSON.stringify(action.easing)};
    await new Promise((resolve) => {
      const started = performance.now();
      const tick = (now) => {
        const raw = Math.min(1, Math.max(0, (now - started) / duration));
        const progress = easing === 'linear' ? raw : raw * raw * (3 - 2 * raw);
        scrollTo(startX + (targetX - startX) * progress, startY + (targetY - startY) * progress);
        if (raw < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return 'OK';
  })()`, true, action.durationMs + 10_000);
  if (result !== 'OK') throw new Error(`scroll selector ${action.selector ?? '(coordinates)'} was not found`);
}

async function elementCenter(devtools: Devtools, selector: string): Promise<{ x: number; y: number; inputType: string }> {
  const result = await evaluateValue<{ ok: boolean; x?: number; y?: number; inputType?: string }>(devtools, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { ok: false };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' || style.visibility === 'hidden') return { ok: false };
    const inputType = element instanceof HTMLInputElement ? element.type : '';
    return { ok: true, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, inputType };
  })()`);
  if (!result.ok || result.x === undefined || result.y === undefined) {
    throw new Error(`selector ${selector} is missing or not visible`);
  }
  return { x: result.x, y: result.y, inputType: result.inputType ?? '' };
}

async function realClick(devtools: Devtools, selector: string): Promise<void> {
  const point = await elementCenter(devtools, selector);
  await sendCommand(devtools, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await sendCommand(devtools, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await sendCommand(devtools, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
}

async function realType(devtools: Devtools, action: Extract<CaptureAction, { type: 'type' }>): Promise<void> {
  const point = await elementCenter(devtools, action.selector);
  if (point.inputType.toLowerCase() === 'password') {
    throw new Error(`refusing to type into password selector ${action.selector}`);
  }
  await realClick(devtools, action.selector);
  if (action.clear) {
    const selectAllModifier = process.platform === 'darwin' ? 4 : 2;
    await sendCommand(devtools, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: selectAllModifier });
    await sendCommand(devtools, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: selectAllModifier });
    await sendCommand(devtools, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
    await sendCommand(devtools, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  }
  const value = resolveTypeValue(action, process.env);
  for (const character of value) {
    await sendCommand(devtools, 'Input.insertText', { text: character });
    if (action.delayMs > 0) await wait(action.delayMs);
  }
}

async function runAction(devtools: Devtools, action: CaptureAction): Promise<void> {
  if (action.type === 'wait') await wait(action.durationMs);
  else if (action.type === 'waitFor') await waitForMarker(devtools, action.marker);
  else if (action.type === 'scroll') await scrollAction(devtools, action);
  else if (action.type === 'click') {
    await realClick(devtools, action.selector);
    if (action.settleMs > 0) await wait(action.settleMs);
  } else {
    await realType(devtools, action);
    if (action.settleMs > 0) await wait(action.settleMs);
  }
}

async function safeRemoveTemporary(path: string, expectedPrefix: string): Promise<void> {
  const absolute = resolve(path);
  const tempRoot = resolve(tmpdir());
  if (dirname(absolute) !== tempRoot || !basename(absolute).startsWith(expectedPrefix)) {
    throw new Error(`refusing to remove unexpected temporary path ${absolute}`);
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(absolute, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      lastError = error;
      await wait(250);
    }
  }
  throw lastError;
}

function ffconcatPath(path: string): string {
  return path.replaceAll('\\', '/').replaceAll("'", "'\\''");
}

function writeConcatManifest(frames: readonly SourceFrame[], captureDurationSeconds: number, target: string): void {
  if (frames.length === 0) throw new Error('cannot encode zero screencast frames');
  const firstTimestamp = frames[0]?.timestampSeconds ?? 0;
  const lines = ['ffconcat version 1.0'];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    if (frame === undefined) continue;
    const next = frames[index + 1];
    const relative = frame.timestampSeconds - firstTimestamp;
    const duration = next === undefined
      ? Math.max(1 / CAPTURE_FPS, captureDurationSeconds - relative)
      : Math.max(1 / CAPTURE_FPS, next.timestampSeconds - frame.timestampSeconds);
    lines.push(`file '${ffconcatPath(frame.file)}'`, `duration ${duration.toFixed(9)}`);
  }
  const last = frames.at(-1);
  if (last !== undefined) lines.push(`file '${ffconcatPath(last.file)}'`);
  writeFileSync(target, `${lines.join('\n')}\n`, 'utf8');
}

function runProcess(command: string, args: readonly string[], timeoutMs = 600_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(new Error(`${command} exited ${code ?? 'without a status'}\n${stderr.slice(-4_000)}`));
    });
  });
}

function ffprobeCommand(): string {
  if (process.env['FFPROBE'] !== undefined) return process.env['FFPROBE'];
  const ffmpeg = process.env['FFMPEG'];
  if (ffmpeg === undefined || !isAbsolute(ffmpeg)) return 'ffprobe';
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return join(dirname(ffmpeg), `ffprobe${suffix}`);
}

async function probeVideo(path: string): Promise<VideoProbe> {
  const probe = await runProcess(ffprobeCommand(), [
    '-v', 'error',
    '-count_frames',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt,r_frame_rate,nb_read_frames',
    '-show_entries', 'format=duration,size',
    '-of', 'json',
    path,
  ]);
  const parsed = JSON.parse(probe.stdout) as {
    streams?: { codec_name?: string; width?: number; height?: number; pix_fmt?: string; r_frame_rate?: string; nb_read_frames?: string }[];
    format?: { duration?: string; size?: string };
  };
  const stream = parsed.streams?.[0];
  const durationSeconds = Number(parsed.format?.duration);
  const bytes = Number(parsed.format?.size);
  const frameCount = Number(stream?.nb_read_frames);
  if (stream?.width !== CAPTURE_WIDTH || stream.height !== CAPTURE_HEIGHT || stream.r_frame_rate !== `${CAPTURE_FPS}/1`) {
    throw new Error(`encoded video is ${stream?.width ?? '?'}x${stream?.height ?? '?'} at ${stream?.r_frame_rate ?? '?'} instead of ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT} at ${CAPTURE_FPS}/1`);
  }
  if (!Number.isInteger(frameCount) || frameCount <= 0
    || !Number.isFinite(durationSeconds) || durationSeconds <= 0
    || !Number.isFinite(bytes) || bytes <= 0) {
    throw new Error('ffprobe returned invalid frame count, duration, or size');
  }
  return {
    codec: stream.codec_name ?? 'unknown',
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt ?? 'unknown',
    frameRate: stream.r_frame_rate,
    frameCount,
    durationSeconds,
    bytes,
  };
}

async function encodeVideo(frames: readonly SourceFrame[], durationSeconds: number, output: string, force: boolean, temp: string): Promise<void> {
  const concat = join(temp, 'frames.ffconcat');
  const partial = join(dirname(output), `.${basename(output, extname(output))}.partial-${process.pid}.mp4`);
  writeConcatManifest(frames, durationSeconds, concat);
  try {
    await runProcess(process.env['FFMPEG'] ?? 'ffmpeg', [
      force ? '-y' : '-n',
      '-hide_banner',
      '-loglevel', 'warning',
      '-f', 'concat',
      '-safe', '0',
      '-i', concat,
      '-vf', `fps=${CAPTURE_FPS},scale=${CAPTURE_WIDTH}:${CAPTURE_HEIGHT}:in_range=full:out_range=tv:flags=lanczos,setsar=1,format=yuv420p`,
      '-r', String(CAPTURE_FPS),
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '16',
      '-movflags', '+faststart',
      '-an',
      partial,
    ]);
  } catch (error) {
    rmSync(partial, { force: true });
    throw error;
  }
  if (existsSync(output)) {
    if (!force) throw new Error(`${output} exists; pass --force to replace it`);
    rmSync(output, { force: true });
  }
  renameSync(partial, output);
}

const cli = parseCli(process.argv.slice(2));
const specFile = resolve(cli.specPath);
const spec = parseBrowserMotionSpec(JSON.parse(readFileSync(specFile, 'utf8')) as unknown);
const output = resolve(cli.outputOverride ?? spec.output);
const metadataPath = resolve(cli.metadataOverride ?? `${output.slice(0, -extname(output).length)}.metadata.json`);
if (existsSync(output) && !cli.force) fail(`${output} exists; pass --force to replace it`);
if (existsSync(metadataPath) && !cli.force) fail(`${metadataPath} exists; pass --force to replace it`);
mkdirSync(dirname(output), { recursive: true });
mkdirSync(dirname(metadataPath), { recursive: true });

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-motion-profile-'));
const framesDirectory = mkdtempSync(join(tmpdir(), 'lacuna-motion-frames-'));
const browser = spawn(chrome, [
  '--headless=new',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--run-all-compositor-stages-before-draw',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  `--window-size=${CAPTURE_WIDTH},${CAPTURE_HEIGHT}`,
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let devtools: Devtools | undefined;
let recording = false;
let receivedFrames = 0;
let acknowledgedFrames = 0;
let acknowledgementFailures = 0;
let savedSequence = 0;
let firstProtocolTimestamp: number | undefined;
let lastSavedSlot = -1;
const protocolSessionIds: number[] = [];
const frames: SourceFrame[] = [];
const frameWrites: Promise<void>[] = [];
const acknowledgements: Promise<void>[] = [];
const actions: ActionResult[] = [];
let captureStartedAtMs = 0;
let captureEndedAtMs = 0;
const sourceOrigin = new URL(spec.url).origin;
const networkRequests = new Map<string, { readonly url: string; readonly method: string }>();
const apiResponses: ApiResponseRecord[] = [];
const apiFailures: ApiFailureRecord[] = [];

function capturedApiPath(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin !== sourceOrigin) return null;
    if (!parsed.pathname.startsWith('/api/') && parsed.pathname !== '/mcp') return null;
    return parsed.pathname;
  } catch {
    return null;
  }
}

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await withTimeout(devtools.attach(), 10_000, 'Target.attachToTarget');
  await sendCommand(devtools, 'Page.enable');
  await sendCommand(devtools, 'Runtime.enable');
  await sendCommand(devtools, 'Network.enable');
  devtools.on('Network.requestWillBeSent', (raw) => {
    const event = raw as NetworkRequestEvent;
    if (typeof event.requestId !== 'string' || typeof event.request?.url !== 'string') return;
    networkRequests.set(event.requestId, {
      url: event.request.url,
      method: event.request.method ?? 'GET',
    });
  });
  devtools.on('Network.responseReceived', (raw) => {
    const event = raw as NetworkResponseEvent;
    const url = event.response?.url;
    const status = event.response?.status;
    if (typeof url !== 'string' || typeof status !== 'number') return;
    const path = capturedApiPath(url);
    if (path === null) return;
    const request = typeof event.requestId === 'string' ? networkRequests.get(event.requestId) : undefined;
    apiResponses.push({ method: request?.method ?? 'GET', path, status });
  });
  devtools.on('Network.loadingFailed', (raw) => {
    const event = raw as NetworkFailureEvent;
    if (typeof event.requestId !== 'string') return;
    const request = networkRequests.get(event.requestId);
    if (request === undefined) return;
    const path = capturedApiPath(request.url);
    if (path === null) return;
    apiFailures.push({
      method: request.method,
      path,
      error: event.errorText ?? 'request failed',
      canceled: event.canceled ?? false,
    });
  });
  // `attach()` creates a new tab while Chrome's bootstrap about:blank tab is
  // still present. Screencast events are only reliable for the foreground
  // target, even in headless mode.
  await sendCommand(devtools, 'Page.bringToFront');
  await sendCommand(devtools, 'Emulation.setDeviceMetricsOverride', {
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sendCommand(devtools, 'Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'no-preference' },
    ],
  });
  try { await sendCommand(devtools, 'Emulation.setTimezoneOverride', { timezoneId: 'UTC' }); } catch { /* Older Chrome. */ }
  try { await sendCommand(devtools, 'Emulation.setLocaleOverride', { locale: 'en-GB' }); } catch { /* Older Chrome. */ }

  devtools.on('Page.screencastFrame', (raw) => {
    const event = raw as ScreencastEvent;
    if (typeof event.sessionId !== 'number' || typeof event.data !== 'string') return;
    receivedFrames += 1;
    protocolSessionIds.push(event.sessionId);
    const rawAcknowledgement = devtools?.send('Page.screencastFrameAck', { sessionId: event.sessionId });
    const acknowledgement = rawAcknowledgement === undefined
      ? undefined
      : withTimeout(rawAcknowledgement, 5_000, 'Page.screencastFrameAck')
      .then(() => { acknowledgedFrames += 1; })
      .catch(() => { acknowledgementFailures += 1; });
    if (acknowledgement !== undefined) acknowledgements.push(acknowledgement);
    if (!recording) return;

    const receivedAtMs = Date.now();
    // Receipt time shares a clock with the initial surface seed. CDP's
    // metadata timestamp is browser-monotonic and cannot safely be mixed with
    // Node wall time for that first interval.
    const timestampSeconds = receivedAtMs / 1_000;
    firstProtocolTimestamp ??= timestampSeconds;
    const slot = Math.floor(Math.max(0, timestampSeconds - firstProtocolTimestamp) * CAPTURE_FPS + 0.000_001);
    if (slot <= lastSavedSlot) return;
    lastSavedSlot = slot;
    const bytes = Buffer.from(event.data, 'base64');
    const dimensions = jpegDimensions(bytes);
    savedSequence += 1;
    const file = join(framesDirectory, `frame-${String(savedSequence).padStart(6, '0')}.jpg`);
    frames.push({
      sequence: savedSequence,
      protocolSessionId: event.sessionId,
      timestampSeconds,
      receivedAtMs,
      file,
      width: dimensions.width,
      height: dimensions.height,
    });
    frameWrites.push(writeFileAsync(file, bytes));
  });

  const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  await sendCommand(devtools, 'Page.navigate', { url: spec.url }, LOAD_TIMEOUT_MS);
  await loaded;
  for (const marker of spec.ready) await waitForMarker(devtools, marker);
  await installPrivacyMasks(devtools, spec.maskSelectors);
  await wait(100);
  await sendCommand(devtools, 'Page.bringToFront');

  recording = true;
  captureStartedAtMs = Date.now();
  await sendCommand(devtools, 'Page.startScreencast', {
    format: 'jpeg',
    quality: 94,
    maxWidth: CAPTURE_WIDTH,
    maxHeight: CAPTURE_HEIGHT,
    everyNthFrame: 1,
  }, 20_000);

  // A static page is allowed not to paint immediately after screencast starts.
  // Insert and remove a transparent compositor layer to request that initial
  // real frame without changing a visible product pixel or substituting a
  // screenshot. A one-pixel reversible scroll is the fallback for engines
  // that optimize the transparent layer away.
  await evaluateValue<string>(devtools, `(async () => {
    const pulse = document.createElement('div');
    pulse.setAttribute('aria-hidden', 'true');
    pulse.style.cssText = 'position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none;will-change:transform;z-index:2147483647';
    document.documentElement.append(pulse);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    pulse.remove();
    return 'OK';
  })()`, true, 5_000);
  let initialDeadline = Date.now() + 1_000;
  while (receivedFrames === 0 && Date.now() < initialDeadline) await wait(25);
  if (receivedFrames === 0) {
    await evaluateValue<string>(devtools, `(async () => {
      const start = scrollY;
      scrollTo(scrollX, Math.min(start + 1, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      scrollTo(scrollX, start);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return 'OK';
    })()`, true, 5_000);
    initialDeadline = Date.now() + 1_000;
    while (receivedFrames === 0 && Date.now() < initialDeadline) await wait(25);
  }

  for (let index = 0; index < spec.actions.length; index += 1) {
    const action = spec.actions[index];
    if (action === undefined) continue;
    const startedAtMs = Date.now();
    await runAction(devtools, action);
    actions.push({
      index,
      action: actionForMetadata(action),
      startedAtMs: startedAtMs - captureStartedAtMs,
      durationMs: Date.now() - startedAtMs,
      ok: true,
    });
  }
  for (const marker of spec.success) await waitForMarker(devtools, marker);
  if (spec.settleMs > 0) await wait(spec.settleMs);
  const badApiResponses = apiResponses.filter((response) => response.status >= 400);
  const expectedStatusKeys = new Set(spec.expectedApiStatuses.map((it) => `${it.path}:${it.status}`));
  const observedBadStatusKeys = new Set(badApiResponses.map((it) => `${it.path}:${it.status}`));
  const unexpectedBadApiResponses = badApiResponses.filter((it) => !expectedStatusKeys.has(`${it.path}:${it.status}`));
  const missingExpectedStatuses = spec.expectedApiStatuses.filter((it) => !observedBadStatusKeys.has(`${it.path}:${it.status}`));
  const successfulApiKeys = new Set(apiResponses.filter((it) => it.status < 400).map((it) => `${it.method}:${it.path}`));
  // React StrictMode intentionally mounts, aborts, then remounts effects in
  // development. Accept that canceled probe only when the same method/path
  // also completed below HTTP 400 in this exact shot; a bare cancel still
  // fails closed.
  const toleratedCanceledFailures = apiFailures.filter((it) => it.canceled && successfulApiKeys.has(`${it.method}:${it.path}`));
  const transportFailures = apiFailures.filter((it) => !toleratedCanceledFailures.includes(it));
  if (unexpectedBadApiResponses.length > 0 || missingExpectedStatuses.length > 0 || transportFailures.length > 0) {
    const statuses = unexpectedBadApiResponses.map((it) => `${it.method} ${it.path} ${it.status}`);
    const missing = missingExpectedStatuses.map((it) => `missing expected ${it.path} ${it.status}`);
    const failures = transportFailures.map((it) => `${it.method} ${it.path} ${it.error} canceled=${it.canceled}`);
    throw new Error(`capture observed unapproved local API traffic: ${[...statuses, ...missing, ...failures].join('; ')}`);
  }
  captureEndedAtMs = Date.now();
  await sendCommand(devtools, 'Page.stopScreencast', {}, 20_000);
  recording = false;
  // Let an already queued final frame deliver and be acknowledged before the
  // promise arrays are frozen for the integrity check.
  await wait(100);
  await Promise.all(frameWrites);
  await Promise.all(acknowledgements);

  if (receivedFrames === 0) throw new Error('Chrome emitted no acknowledged screencast frame during the shot');
  if (frames.length < 2) throw new Error('capture ended without a streamed browser frame');
  const invalidDimensions = frames.filter((frame) => frame.width !== CAPTURE_WIDTH || frame.height !== CAPTURE_HEIGHT);
  if (invalidDimensions.length > 0) {
    const example = invalidDimensions[0];
    throw new Error(`Chrome emitted ${invalidDimensions.length} non-${CAPTURE_WIDTH}x${CAPTURE_HEIGHT} frames (example ${example?.width}x${example?.height})`);
  }
  if (acknowledgementFailures > 0 || acknowledgedFrames !== receivedFrames) {
    throw new Error(`screencast acknowledgement mismatch: received=${receivedFrames}, acknowledged=${acknowledgedFrames}, failed=${acknowledgementFailures}`);
  }

  const firstFrame = frames[0];
  const lastFrame = frames.at(-1);
  const observedSourceSeconds = firstFrame === undefined || lastFrame === undefined
    ? 0
    : Math.max(0, lastFrame.timestampSeconds - firstFrame.timestampSeconds) + 1 / CAPTURE_FPS;
  const durationSeconds = Math.max(
    1 / CAPTURE_FPS,
    (captureEndedAtMs - captureStartedAtMs) / 1_000,
    observedSourceSeconds,
  );
  const uniqueSourcePayloads = new Set(frames.map((frame) => sha256Hex(readFileSync(frame.file)))).size;
  if (uniqueSourcePayloads < 2) throw new Error('capture contains no moving-pixel change across its real browser frames');
  await encodeVideo(frames, durationSeconds, output, cli.force, framesDirectory);
  const probe = await probeVideo(output);
  const metrics = frameMetrics(
    receivedFrames,
    frames,
    acknowledgedFrames,
    acknowledgementFailures,
    protocolSessionIds,
    probe.frameCount / CAPTURE_FPS,
  );
  const bytes = statSync(output).size;
  if (bytes !== probe.bytes) throw new Error(`ffprobe byte count ${probe.bytes} does not match filesystem byte count ${bytes}`);
  const videoHash = sha256Hex(readFileSync(output));
  const browserVersion = await sendCommand<{ product?: string; revision?: string }>(devtools, 'Browser.getVersion');
  const metadata = {
    schemaVersion: 1,
    name: spec.name,
    capturedAt: new Date().toISOString(),
    source: {
      url: sanitizedSourceUrl(spec.url),
      queryAndFragmentPersisted: false,
      ready: spec.ready.map(markerForMetadata),
      success: spec.success.map(markerForMetadata),
    },
    video: {
      file: basename(output),
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      fps: CAPTURE_FPS,
      durationSeconds: Math.round(probe.durationSeconds * 1_000) / 1_000,
      bytes,
      sha256: videoHash,
      codec: probe.codec,
      pixelFormat: probe.pixelFormat,
      frameRate: probe.frameRate,
      frameCount: probe.frameCount,
      audio: false,
    },
    capture: {
      method: 'Chrome DevTools Protocol Page.startScreencast',
      frameFormat: 'jpeg',
      acknowledgementRequired: true,
      ...metrics,
      uniqueSourcePayloads,
      sourceDimensions: [...new Set(frames.map((frame) => `${frame.width}x${frame.height}`))],
      browser: browserVersion.product ?? 'Chrome',
      browserRevision: browserVersion.revision ?? 'unknown',
    },
    network: {
      policy: 'same-origin /api/* and /mcp responses must remain below HTTP 400 unless an exact path/status pair is declared; loading failures are rejected',
      expectedApiStatuses: spec.expectedApiStatuses,
      apiResponseCount: apiResponses.length,
      apiResponses,
      apiFailureCount: apiFailures.length,
      apiFailures,
      toleratedCanceledFailureCount: toleratedCanceledFailures.length,
      toleratedCanceledFailures,
    },
    actions,
    privacy: {
      typedValuesPersistedInMetadata: false,
      exactMarkerValuesPersistedInMetadata: false,
      urlQueryPersistedInMetadata: false,
      passwordInputAllowed: false,
      automaticMaskSelectors: DEFAULT_MASK_SELECTORS,
      customMaskSelectorCount: spec.maskSelectors.length,
    },
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  process.stdout.write(`CAPTURE_MOTION_OK ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}@${CAPTURE_FPS} ${probe.durationSeconds.toFixed(3)}s\n`);
  process.stdout.write(`video    ${output}\nmetadata ${metadataPath}\n`);
  process.stdout.write(`frames   ${receivedFrames} received, ${frames.length} saved, ${metrics.protocolSequenceGaps} protocol gaps, ${metrics.estimatedMissingFramesAt30Fps} estimated 30fps gaps\n`);
  process.stdout.write(`sha256   ${videoHash}\n`);
} finally {
  recording = false;
  devtools?.close();
  const browserClosed = new Promise<void>((resolveClose) => {
    if (browser.exitCode !== null) resolveClose();
    else browser.once('close', () => resolveClose());
  });
  browser.kill();
  await Promise.race([browserClosed, wait(4_000)]);
  try { await safeRemoveTemporary(profile, 'lacuna-motion-profile-'); } catch (error) { process.stderr.write(`${String(error)}\n`); }
  if (!cli.keepFrames) {
    try { await safeRemoveTemporary(framesDirectory, 'lacuna-motion-frames-'); } catch (error) { process.stderr.write(`${String(error)}\n`); }
  } else {
    process.stdout.write(`frames   ${framesDirectory}\n`);
  }
}
