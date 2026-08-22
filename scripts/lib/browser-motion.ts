import { createHash } from 'node:crypto';

export const CAPTURE_WIDTH = 1_920;
export const CAPTURE_HEIGHT = 1_080;
export const CAPTURE_FPS = 30;

export type MarkerState = 'attached' | 'visible' | 'hidden';

export interface MarkerSpec {
  readonly selector: string;
  readonly state: MarkerState;
  readonly timeoutMs: number;
  readonly textEquals?: string;
  readonly textIncludes?: string;
  readonly attribute?: {
    readonly name: string;
    readonly equals: string;
  };
}

export interface WaitAction {
  readonly type: 'wait';
  readonly durationMs: number;
}

export interface WaitForAction {
  readonly type: 'waitFor';
  readonly marker: MarkerSpec;
}

export interface ScrollAction {
  readonly type: 'scroll';
  readonly durationMs: number;
  readonly easing: 'linear' | 'smoothstep';
  readonly x?: number;
  readonly y?: number;
  readonly selector?: string;
  readonly align?: 'start' | 'center' | 'end';
  readonly offsetPx: number;
}

export interface ClickAction {
  readonly type: 'click';
  readonly selector: string;
  readonly settleMs: number;
}

export interface ExpectedApiStatus {
  readonly path: string;
  readonly status: number;
}

export interface TypeAction {
  readonly type: 'type';
  readonly selector: string;
  readonly text?: string;
  readonly textEnv?: string;
  readonly clear: boolean;
  readonly delayMs: number;
  readonly settleMs: number;
}

export type CaptureAction = WaitAction | WaitForAction | ScrollAction | ClickAction | TypeAction;

export interface BrowserMotionSpec {
  readonly version: 1;
  readonly name: string;
  readonly url: string;
  readonly output: string;
  readonly viewport: {
    readonly width: typeof CAPTURE_WIDTH;
    readonly height: typeof CAPTURE_HEIGHT;
    readonly deviceScaleFactor: 1;
  };
  readonly fps: typeof CAPTURE_FPS;
  readonly ready: readonly MarkerSpec[];
  readonly actions: readonly CaptureAction[];
  readonly success: readonly MarkerSpec[];
  readonly maskSelectors: readonly string[];
  readonly expectedApiStatuses: readonly ExpectedApiStatus[];
  readonly settleMs: number;
}

export interface SourceFrame {
  readonly sequence: number;
  readonly protocolSessionId: number;
  readonly timestampSeconds: number;
  readonly receivedAtMs: number;
  readonly file: string;
  readonly width: number;
  readonly height: number;
}

export interface FrameMetrics {
  readonly receivedFrames: number;
  readonly savedFrames: number;
  readonly acknowledgedFrames: number;
  readonly acknowledgementFailures: number;
  readonly protocolSequenceGaps: number;
  readonly discardedAboveTargetRate: number;
  readonly targetFrames: number;
  readonly uniqueSourceFramesUsed: number;
  readonly duplicatedTargetFrames: number;
  readonly discardedSourceFramesDuringEncode: number;
  readonly estimatedMissingFramesAt30Fps: number;
  readonly longestSourceGapMs: number;
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`);
  return value;
}

function asFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
}

function asIntegerInRange(value: unknown, label: string, min: number, max: number): number {
  const number = asFiniteNumber(value, label);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : asString(value, label);
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${label} must be true or false`);
  return value;
}

function parseMarker(value: unknown, label: string, defaultTimeoutMs = 15_000): MarkerSpec {
  const input = asObject(value, label);
  const selector = asString(input['selector'], `${label}.selector`);
  const rawState = input['state'] ?? 'visible';
  if (rawState !== 'attached' && rawState !== 'visible' && rawState !== 'hidden') {
    throw new Error(`${label}.state must be attached, visible, or hidden`);
  }
  const timeoutMs = input['timeoutMs'] === undefined
    ? defaultTimeoutMs
    : asIntegerInRange(input['timeoutMs'], `${label}.timeoutMs`, 50, 120_000);
  const textEquals = optionalString(input['textEquals'], `${label}.textEquals`);
  const textIncludes = optionalString(input['textIncludes'], `${label}.textIncludes`);
  if (textEquals !== undefined && textIncludes !== undefined) {
    throw new Error(`${label} cannot set both textEquals and textIncludes`);
  }
  const rawAttribute = input['attribute'];
  let attribute: MarkerSpec['attribute'];
  if (rawAttribute !== undefined) {
    const parsed = asObject(rawAttribute, `${label}.attribute`);
    attribute = {
      name: asString(parsed['name'], `${label}.attribute.name`),
      equals: asString(parsed['equals'], `${label}.attribute.equals`),
    };
  }
  return {
    selector,
    state: rawState,
    timeoutMs,
    ...(textEquals === undefined ? {} : { textEquals }),
    ...(textIncludes === undefined ? {} : { textIncludes }),
    ...(attribute === undefined ? {} : { attribute }),
  };
}

function parseAction(value: unknown, index: number): CaptureAction {
  const label = `actions[${index}]`;
  const input = asObject(value, label);
  const type = asString(input['type'], `${label}.type`);
  if (type === 'wait') {
    return {
      type,
      durationMs: asIntegerInRange(input['durationMs'], `${label}.durationMs`, 1, 120_000),
    };
  }
  if (type === 'waitFor') {
    return { type, marker: parseMarker(input['marker'], `${label}.marker`) };
  }
  if (type === 'scroll') {
    const selector = optionalString(input['selector'], `${label}.selector`);
    const x = input['x'] === undefined ? undefined : asFiniteNumber(input['x'], `${label}.x`);
    const y = input['y'] === undefined ? undefined : asFiniteNumber(input['y'], `${label}.y`);
    if (selector === undefined && y === undefined) throw new Error(`${label} needs selector or y`);
    if (selector !== undefined && (x !== undefined || y !== undefined)) {
      throw new Error(`${label} cannot combine selector with x or y`);
    }
    const rawEasing = input['easing'] ?? 'smoothstep';
    if (rawEasing !== 'linear' && rawEasing !== 'smoothstep') {
      throw new Error(`${label}.easing must be linear or smoothstep`);
    }
    const rawAlign = input['align'] ?? 'center';
    if (rawAlign !== 'start' && rawAlign !== 'center' && rawAlign !== 'end') {
      throw new Error(`${label}.align must be start, center, or end`);
    }
    return {
      type,
      durationMs: asIntegerInRange(input['durationMs'], `${label}.durationMs`, 50, 120_000),
      easing: rawEasing,
      offsetPx: input['offsetPx'] === undefined
        ? 0
        : asFiniteNumber(input['offsetPx'], `${label}.offsetPx`),
      ...(selector === undefined ? {} : { selector, align: rawAlign }),
      ...(x === undefined ? {} : { x }),
      ...(y === undefined ? {} : { y }),
    };
  }
  if (type === 'click') {
    return {
      type,
      selector: asString(input['selector'], `${label}.selector`),
      settleMs: input['settleMs'] === undefined
        ? 250
        : asIntegerInRange(input['settleMs'], `${label}.settleMs`, 0, 120_000),
    };
  }
  if (type === 'type') {
    const text = optionalString(input['text'], `${label}.text`);
    const textEnv = optionalString(input['textEnv'], `${label}.textEnv`);
    if ((text === undefined) === (textEnv === undefined)) {
      throw new Error(`${label} must set exactly one of text or textEnv`);
    }
    if (textEnv !== undefined && !/^[A-Z][A-Z0-9_]*$/.test(textEnv)) {
      throw new Error(`${label}.textEnv must be an uppercase environment variable name`);
    }
    return {
      type,
      selector: asString(input['selector'], `${label}.selector`),
      clear: optionalBoolean(input['clear'], `${label}.clear`, true),
      delayMs: input['delayMs'] === undefined
        ? 42
        : asIntegerInRange(input['delayMs'], `${label}.delayMs`, 0, 2_000),
      settleMs: input['settleMs'] === undefined
        ? 250
        : asIntegerInRange(input['settleMs'], `${label}.settleMs`, 0, 120_000),
      ...(text === undefined ? {} : { text }),
      ...(textEnv === undefined ? {} : { textEnv }),
    };
  }
  throw new Error(`${label}.type is not supported`);
}

export function parseBrowserMotionSpec(value: unknown): BrowserMotionSpec {
  const input = asObject(value, 'spec');
  if (input['version'] !== 1) throw new Error('spec.version must be 1');
  const viewport = asObject(input['viewport'], 'spec.viewport');
  if (viewport['width'] !== CAPTURE_WIDTH || viewport['height'] !== CAPTURE_HEIGHT) {
    throw new Error(`spec.viewport must be ${CAPTURE_WIDTH}x${CAPTURE_HEIGHT}`);
  }
  if (viewport['deviceScaleFactor'] !== 1) throw new Error('spec.viewport.deviceScaleFactor must be 1');
  if (input['fps'] !== CAPTURE_FPS) throw new Error(`spec.fps must be ${CAPTURE_FPS}`);

  const rawReady = input['ready'];
  const rawActions = input['actions'];
  const rawSuccess = input['success'];
  if (!Array.isArray(rawReady) || rawReady.length === 0) throw new Error('spec.ready must contain at least one exact marker');
  if (!Array.isArray(rawActions) || rawActions.length === 0) throw new Error('spec.actions must contain at least one action');
  if (!Array.isArray(rawSuccess) || rawSuccess.length === 0) throw new Error('spec.success must contain at least one exact marker');

  const rawMaskSelectors = input['maskSelectors'] ?? [];
  if (!Array.isArray(rawMaskSelectors)) throw new Error('spec.maskSelectors must be an array');
  const maskSelectors = rawMaskSelectors.map((entry, index) => asString(entry, `spec.maskSelectors[${index}]`));
  const rawExpectedStatuses = input['expectedApiStatuses'] ?? [];
  if (!Array.isArray(rawExpectedStatuses)) throw new Error('spec.expectedApiStatuses must be an array');
  const expectedApiStatuses = rawExpectedStatuses.map((entry, index) => {
    const value = asObject(entry, `spec.expectedApiStatuses[${index}]`);
    const path = asString(value['path'], `spec.expectedApiStatuses[${index}].path`);
    if (!path.startsWith('/api/') && path !== '/mcp') {
      throw new Error(`spec.expectedApiStatuses[${index}].path must be /api/* or /mcp`);
    }
    return {
      path,
      status: asIntegerInRange(value['status'], `spec.expectedApiStatuses[${index}].status`, 400, 599),
    };
  });

  const parsedUrl = new URL(asString(input['url'], 'spec.url'));
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('spec.url must use http or https');
  }
  if (parsedUrl.username !== '' || parsedUrl.password !== '') throw new Error('spec.url cannot contain credentials');
  for (const name of parsedUrl.searchParams.keys()) {
    if (/(?:^|_)(?:token|key|secret|auth|password|session|code)(?:$|_)/i.test(name)) {
      throw new Error(`spec.url contains a sensitive query parameter named ${name}`);
    }
  }

  return {
    version: 1,
    name: asString(input['name'], 'spec.name'),
    url: parsedUrl.toString(),
    output: asString(input['output'], 'spec.output'),
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT, deviceScaleFactor: 1 },
    fps: CAPTURE_FPS,
    ready: rawReady.map((entry, index) => parseMarker(entry, `ready[${index}]`)),
    actions: rawActions.map((entry, index) => parseAction(entry, index)),
    success: rawSuccess.map((entry, index) => parseMarker(entry, `success[${index}]`)),
    maskSelectors,
    expectedApiStatuses,
    settleMs: input['settleMs'] === undefined
      ? 250
      : asIntegerInRange(input['settleMs'], 'spec.settleMs', 0, 120_000),
  };
}

export function sanitizedSourceUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}`;
}

export function markerForMetadata(marker: MarkerSpec): Record<string, unknown> {
  return {
    selector: marker.selector,
    state: marker.state,
    timeoutMs: marker.timeoutMs,
    textPredicate: marker.textEquals === undefined && marker.textIncludes === undefined
      ? 'none'
      : marker.textEquals === undefined ? 'includes:[REDACTED]' : 'equals:[REDACTED]',
    attributePredicate: marker.attribute === undefined
      ? 'none'
      : `${marker.attribute.name}=[REDACTED]`,
  };
}

export function actionForMetadata(action: CaptureAction): Record<string, unknown> {
  if (action.type === 'type') {
    return {
      type: action.type,
      selector: action.selector,
      value: '[REDACTED]',
      source: action.textEnv === undefined ? 'literal' : 'environment',
      clear: action.clear,
      delayMs: action.delayMs,
      settleMs: action.settleMs,
    };
  }
  if (action.type === 'waitFor') return { type: action.type, marker: markerForMetadata(action.marker) };
  return { ...action };
}

export function resolveTypeValue(action: TypeAction, environment: NodeJS.ProcessEnv): string {
  if (action.text !== undefined) return action.text;
  const name = action.textEnv;
  if (name === undefined) throw new Error('type action has no input source');
  const value = environment[name];
  if (value === undefined || value === '') throw new Error(`type action environment variable ${name} is not set`);
  return value;
}

export function sha256Hex(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Width and height from a baseline/progressive JPEG SOF marker. */
export function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('screencast frame is not a JPEG');
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) break;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const size = bytes.readUInt16BE(offset + 2);
    if (size < 2 || offset + 2 + size > bytes.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + size;
  }
  throw new Error('screencast JPEG has no supported dimensions marker');
}

export function frameMetrics(
  receivedFrames: number,
  savedFrames: readonly SourceFrame[],
  acknowledgedFrames: number,
  acknowledgementFailures: number,
  protocolSessionIds: readonly number[],
  captureDurationSeconds: number,
  seedFrames = 0,
): FrameMetrics {
  const targetFrames = Math.max(1, Math.round(captureDurationSeconds * CAPTURE_FPS));
  const relativeTimes = savedFrames.map((frame) => Math.max(0, frame.timestampSeconds - (savedFrames[0]?.timestampSeconds ?? 0)));
  let longestSourceGapMs = 0;
  let estimatedMissingFramesAt30Fps = 0;
  for (let index = 1; index < relativeTimes.length; index += 1) {
    const previous = relativeTimes[index - 1];
    const current = relativeTimes[index];
    if (previous === undefined || current === undefined) continue;
    const gapSeconds = Math.max(0, current - previous);
    longestSourceGapMs = Math.max(longestSourceGapMs, gapSeconds * 1_000);
    estimatedMissingFramesAt30Fps += Math.max(0, Math.floor(gapSeconds * CAPTURE_FPS) - 1);
  }

  const selected = new Set<number>();
  let sourceIndex = 0;
  for (let targetIndex = 0; targetIndex < targetFrames; targetIndex += 1) {
    const targetSeconds = targetIndex / CAPTURE_FPS;
    while (sourceIndex + 1 < relativeTimes.length
      && (relativeTimes[sourceIndex + 1] ?? Number.POSITIVE_INFINITY) <= targetSeconds) {
      sourceIndex += 1;
    }
    if (savedFrames.length > 0) selected.add(sourceIndex);
  }

  let protocolSequenceGaps = 0;
  for (let index = 1; index < protocolSessionIds.length; index += 1) {
    const previous = protocolSessionIds[index - 1];
    const current = protocolSessionIds[index];
    if (previous === undefined || current === undefined) continue;
    protocolSequenceGaps += Math.max(0, current - previous - 1);
  }

  return {
    receivedFrames,
    savedFrames: savedFrames.length,
    acknowledgedFrames,
    acknowledgementFailures,
    protocolSequenceGaps,
    discardedAboveTargetRate: Math.max(0, receivedFrames + seedFrames - savedFrames.length),
    targetFrames,
    uniqueSourceFramesUsed: selected.size,
    duplicatedTargetFrames: Math.max(0, targetFrames - selected.size),
    discardedSourceFramesDuringEncode: Math.max(0, savedFrames.length - selected.size),
    estimatedMissingFramesAt30Fps,
    longestSourceGapMs: Math.round(longestSourceGapMs * 1_000) / 1_000,
  };
}
