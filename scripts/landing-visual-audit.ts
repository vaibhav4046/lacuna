import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * V10 landing acceptance in a real browser.
 *
 * This is deliberately about the things a compile cannot prove: the approved
 * field exists, the rejected aperture/card system is absent, navigation stays
 * usable, every viewport remains inside the page, and each semantic morph
 * produces a materially different frame. It writes screenshots and a compact
 * machine-readable report under artifacts/visual-v10/preview.
 *
 *   npm run audit:landing -- http://127.0.0.1:4174
 */

const BASE = (process.argv[2] ?? 'http://127.0.0.1:4174').replace(/\/+$/, '');
const OUT = 'artifacts/visual-v10/preview';
const LOAD_TIMEOUT_MS = 25_000;

const VIEWPORTS = [
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'phone-430', width: 430, height: 932, mobile: true },
  { name: 'tablet-768', width: 768, height: 1_024, mobile: false },
  { name: 'laptop-1366', width: 1_366, height: 768, mobile: false },
  { name: 'laptop-1440', width: 1_440, height: 900, mobile: false },
  { name: 'desktop-1920', width: 1_920, height: 1_080, mobile: false },
  { name: 'desktop-2560', width: 2_560, height: 1_440, mobile: false },
  { name: 'desktop-3840', width: 3_840, height: 2_160, mobile: false },
] as const;

const STAGES = [
  ['hero', '#top', 'hero'],
  ['facts-change', '#product', 'real'],
  ['missing-evidence', '[data-scene="gap"]', 'gap'],
  ['architecture', '#how', 'arch'],
  ['context-funnel', '[data-scene="funnel"]', 'funnel'],
  ['context-health', '[data-scene="org"]', 'org'],
  ['temporal', '[data-scene="temporal"]', 'temporal'],
  ['conflict', '[data-scene="contra"]', 'contra'],
  ['context-pack', '[data-scene="pack"]', 'pack'],
  ['context-speed', '[data-scene="speed"]', 'speed'],
  ['any-agent', '[data-scene="any"]', 'any'],
  ['model-route', '[data-scene="route"]', 'route'],
  ['harness', '[data-scene="harness"]', 'harness'],
  ['handoff', '[data-scene="hand"]', 'hand'],
  ['voice', '#voice-scene', 'voice'],
  ['connectors', '[data-scene="conn"]', 'conn'],
  ['mcp', '#mcp', 'mcp'],
  ['cli', '#cli', 'off'],
  ['hydradb', '#hydra', 'hydra'],
  ['final', '[data-scene="final"]', 'final'],
] as const;

const MOBILE_STAGES = [
  ['context-pack', '[data-scene="pack"]', 'pack'],
  ['model-route', '[data-scene="route"]', 'route'],
  ['handoff', '[data-scene="hand"]', 'hand'],
  ['voice', '#voice-scene', 'voice'],
  ['connectors', '[data-scene="conn"]', 'conn'],
  ['mcp', '#mcp', 'mcp'],
  ['hydradb', '#hydra', 'hydra'],
] as const;

const EXPECTED_STAGE_PNGS = new Set([
  ...STAGES.map(([name]) => `stage-${name}-1440.png`),
  ...MOBILE_STAGES.map(([name]) => `stage-${name}-390.png`),
  'stage-context-pack-hover-1440.png',
  'stage-context-pack-expanded-1440.png',
]);

type StageName = typeof STAGES[number][0];

interface CanvasReadability {
  readonly width: number;
  readonly height: number;
  readonly totalPixels: number;
  /** Pixels whose effective luminance over the black page is at least 12/255. */
  readonly visiblePixels: number;
  /** Pixels whose effective luminance over the black page is at least 36/255. */
  readonly readablePixels: number;
  /** Pixels whose effective luminance over the black page is at least 72/255. */
  readonly brightPixels: number;
  readonly visibleRatio: number;
  readonly readableRatio: number;
  readonly brightRatio: number;
  readonly readableShare: number;
  readonly meanVisibleLuma: number;
  readonly p75VisibleLuma: number;
  readonly p90VisibleLuma: number;
  readonly maxLuma: number;
  readonly occupiedWidthRatio: number;
  readonly occupiedHeightRatio: number;
  readonly occupiedAreaRatio: number;
  readonly occupiedTiles: number;
  readonly totalTiles: number;
}

interface ReadabilityThreshold {
  readonly minReadablePixels: number;
  readonly minBrightPixels: number;
  readonly minReadableShare: number;
  readonly minP90VisibleLuma: number;
  readonly minOccupiedWidthRatio: number;
  readonly minOccupiedHeightRatio: number;
  readonly minOccupiedTiles: number;
}

const READABILITY_THRESHOLDS = {
  ambient: {
    minReadablePixels: 1,
    minBrightPixels: 0,
    minReadableShare: 0,
    minP90VisibleLuma: 15,
    minOccupiedWidthRatio: 0.50,
    minOccupiedHeightRatio: 0.40,
    minOccupiedTiles: 0,
  },
  sparse: {
    minReadablePixels: 280,
    minBrightPixels: 55,
    minReadableShare: 0.08,
    minP90VisibleLuma: 48,
    minOccupiedWidthRatio: 0.20,
    minOccupiedHeightRatio: 0.13,
    minOccupiedTiles: 3,
  },
  standard: {
    minReadablePixels: 720,
    minBrightPixels: 150,
    minReadableShare: 0.12,
    minP90VisibleLuma: 56,
    minOccupiedWidthRatio: 0.30,
    minOccupiedHeightRatio: 0.20,
    minOccupiedTiles: 5,
  },
  expansive: {
    minReadablePixels: 1_400,
    minBrightPixels: 320,
    minReadableShare: 0.16,
    minP90VisibleLuma: 64,
    minOccupiedWidthRatio: 0.42,
    minOccupiedHeightRatio: 0.28,
    minOccupiedTiles: 7,
  },
  // The funnel is the regression shown in the user's screenshot. Its labels
  // could make a nearly black frame look "nonblank", so it has a higher
  // effective-luminance and spatial-coverage contract than other dense scenes.
  funnel: {
    minReadablePixels: 4_500,
    minBrightPixels: 1_600,
    minReadableShare: 0.45,
    minP90VisibleLuma: 120,
    minOccupiedWidthRatio: 0.44,
    minOccupiedHeightRatio: 0.55,
    minOccupiedTiles: 12,
  },
  mobile: {
    minReadablePixels: 420,
    minBrightPixels: 80,
    minReadableShare: 0.08,
    minP90VisibleLuma: 48,
    minOccupiedWidthRatio: 0.24,
    minOccupiedHeightRatio: 0.16,
    minOccupiedTiles: 4,
  },
} as const satisfies Record<string, ReadabilityThreshold>;

const STAGE_READABILITY_PROFILE: Record<StageName, keyof typeof READABILITY_THRESHOLDS> = {
  hero: 'expansive',
  'facts-change': 'expansive',
  'missing-evidence': 'sparse',
  architecture: 'expansive',
  'context-funnel': 'funnel',
  'context-health': 'expansive',
  temporal: 'standard',
  conflict: 'sparse',
  'context-pack': 'standard',
  'context-speed': 'expansive',
  'any-agent': 'standard',
  'model-route': 'standard',
  harness: 'standard',
  handoff: 'standard',
  voice: 'standard',
  connectors: 'standard',
  mcp: 'sparse',
  cli: 'ambient',
  hydradb: 'standard',
  final: 'expansive',
};

interface BrowserReading {
  readonly textLength: number;
  readonly overflow: number;
  readonly sceneCount: number;
  readonly uniqueScenes: number;
  readonly chapterCount: number;
  readonly uniqueChapters: number;
  readonly duplicateIds: readonly string[];
  readonly unnamedButtons: number;
  readonly unnamedButtonSnippets: readonly string[];
  readonly missingAnchors: readonly string[];
  readonly canvasPresent: boolean;
  readonly canvasInkSamples: number;
  readonly canvasReadability: CanvasReadability;
  readonly activeCanvasScene: string | null;
  readonly heroApertureVisible: boolean;
  readonly journeyVisible: boolean;
  readonly headerPosition: string;
  readonly brandVisible: boolean;
  readonly mobileMenuVisible: boolean;
  readonly mobileMenuTouchHeight: number;
  readonly mainPresent: boolean;
  readonly skipLinkPresent: boolean;
  readonly heroHeadlineFullyVisible: boolean;
  readonly heroActionsFullyVisible: boolean;
  readonly heroMainCopyFits: boolean;
  readonly heroContentFullyVisible: boolean;
  readonly heroContentOverflowPx: number;
}

interface ViewportFinding extends BrowserReading {
  readonly viewport: string;
  readonly canvasReadabilityFailures: readonly string[];
  readonly shortDesktopHeroFitRequired: boolean;
  readonly consoleErrors: readonly string[];
  readonly exceptions: readonly string[];
  readonly failedRequests: readonly string[];
  readonly screenshot: string;
  readonly visualOk: boolean;
  readonly ok: boolean;
}

interface SpeedReading {
  readonly present: boolean;
  readonly text: string;
  readonly numericMsValues: readonly string[];
  readonly placeholderMsValues: readonly string[];
  readonly endToEndNumeric: boolean;
  readonly ok: boolean;
}

interface StageReading {
  readonly activeScene: string | null;
  readonly activeProgress: number;
  readonly canvas: CanvasReadability;
  readonly profile: keyof typeof READABILITY_THRESHOLDS;
  readonly threshold: ReadabilityThreshold;
  readonly readabilityFailures: readonly string[];
  readonly readable: boolean;
  readonly speed: SpeedReading | null;
  readonly handoff: HandoffGeometry | null;
}

interface HandoffGeometry {
  readonly headlineRect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null;
  readonly canvasLabelRect: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly overlap: boolean;
  readonly verticalGapPx: number;
  readonly labelInsideViewport: boolean;
  readonly ok: boolean;
}

interface MobileStageReading {
  readonly activeScene: string | null;
  readonly activeProgress: number;
  readonly canvas: CanvasReadability;
  readonly readabilityFailures: readonly string[];
  readonly readable: boolean;
  readonly pageOverflow: number;
  readonly sceneVisible: boolean;
  readonly packList: {
    readonly required: boolean;
    readonly visible: boolean;
    readonly insideViewport: boolean;
    readonly itemCount: number;
    readonly coreOverlap: boolean;
    readonly ok: boolean;
  };
  readonly handoff: HandoffGeometry | null;
  readonly screenshot: string;
}

interface PackRegionReading {
  readonly labelReadablePixels: number;
  readonly labelBrightPixels: number;
  readonly labelAmberPixels: number;
  readonly outerReadablePixels: number;
  readonly outerBrightPixels: number;
  readonly coreReadablePixels: number;
}

interface PackInteractionReading {
  readonly center: { readonly x: number; readonly y: number; readonly radius: number; readonly progress: number };
  readonly baseline: PackRegionReading;
  readonly hover: PackRegionReading;
  readonly expanded: PackRegionReading;
  readonly baselineHash: string;
  readonly hoverHash: string;
  readonly expandedHash: string;
  readonly hoverLabelReadableDelta: number;
  readonly expandedAmberDelta: number;
  readonly expandedOuterReadableDelta: number;
  readonly hoverChanged: boolean;
  readonly expandedChanged: boolean;
  readonly ok: boolean;
}

function canvasReadabilityBrowserExpression(): string {
  return `((canvas) => {
    const empty = {
      width: 0, height: 0, totalPixels: 0,
      visiblePixels: 0, readablePixels: 0, brightPixels: 0,
      visibleRatio: 0, readableRatio: 0, brightRatio: 0, readableShare: 0,
      meanVisibleLuma: 0, p75VisibleLuma: 0, p90VisibleLuma: 0, maxLuma: 0,
      occupiedWidthRatio: 0, occupiedHeightRatio: 0, occupiedAreaRatio: 0,
      occupiedTiles: 0, totalTiles: 96,
    };
    if (!canvas || canvas.width < 1 || canvas.height < 1) return empty;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return empty;
      const width = canvas.width;
      const height = canvas.height;
      const totalPixels = width * height;
      const pixels = context.getImageData(0, 0, width, height).data;
      const histogram = new Uint32Array(256);
      const tileColumns = 12;
      const tileRows = 8;
      const tileCounts = new Uint32Array(tileColumns * tileRows);
      let visiblePixels = 0;
      let readablePixels = 0;
      let brightPixels = 0;
      let visibleLumaTotal = 0;
      let maxLuma = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          const alpha = pixels[offset + 3] / 255;
          if (alpha <= 0) continue;
          // Canvas stores unpremultiplied channels. Multiplying by alpha gives
          // the luminance a person actually sees after compositing over black.
          const luma = Math.max(0, Math.min(255, Math.round((
            pixels[offset] * 0.2126
            + pixels[offset + 1] * 0.7152
            + pixels[offset + 2] * 0.0722
          ) * alpha)));
          if (luma < 12) continue;
          visiblePixels += 1;
          visibleLumaTotal += luma;
          histogram[luma] += 1;
          if (luma > maxLuma) maxLuma = luma;
          if (luma < 36) continue;
          readablePixels += 1;
          if (luma >= 72) brightPixels += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          const tileX = Math.min(tileColumns - 1, Math.floor(x * tileColumns / width));
          const tileY = Math.min(tileRows - 1, Math.floor(y * tileRows / height));
          tileCounts[tileY * tileColumns + tileX] += 1;
        }
      }
      const quantile = (fraction) => {
        if (visiblePixels === 0) return 0;
        const target = Math.ceil(visiblePixels * fraction);
        let seen = 0;
        for (let value = 0; value < histogram.length; value += 1) {
          seen += histogram[value];
          if (seen >= target) return value;
        }
        return 255;
      };
      const occupiedWidth = maxX >= minX ? maxX - minX + 1 : 0;
      const occupiedHeight = maxY >= minY ? maxY - minY + 1 : 0;
      // Three readable pixels rejects single antialiasing specks while still
      // allowing intentionally sparse line-and-node scenes.
      const occupiedTiles = [...tileCounts].filter((count) => count >= 3).length;
      return {
        width, height, totalPixels,
        visiblePixels, readablePixels, brightPixels,
        visibleRatio: totalPixels > 0 ? visiblePixels / totalPixels : 0,
        readableRatio: totalPixels > 0 ? readablePixels / totalPixels : 0,
        brightRatio: totalPixels > 0 ? brightPixels / totalPixels : 0,
        readableShare: visiblePixels > 0 ? readablePixels / visiblePixels : 0,
        meanVisibleLuma: visiblePixels > 0 ? visibleLumaTotal / visiblePixels : 0,
        p75VisibleLuma: quantile(0.75),
        p90VisibleLuma: quantile(0.90),
        maxLuma,
        occupiedWidthRatio: width > 0 ? occupiedWidth / width : 0,
        occupiedHeightRatio: height > 0 ? occupiedHeight / height : 0,
        occupiedAreaRatio: totalPixels > 0 ? occupiedWidth * occupiedHeight / totalPixels : 0,
        occupiedTiles,
        totalTiles: tileColumns * tileRows,
      };
    } catch {
      return empty;
    }
  })(document.querySelector('canvas'))`;
}

function readabilityFailures(
  canvas: CanvasReadability,
  threshold: ReadabilityThreshold,
): string[] {
  const failures: string[] = [];
  if (canvas.readablePixels < threshold.minReadablePixels) failures.push(`readablePixels ${canvas.readablePixels} < ${threshold.minReadablePixels}`);
  if (canvas.brightPixels < threshold.minBrightPixels) failures.push(`brightPixels ${canvas.brightPixels} < ${threshold.minBrightPixels}`);
  if (canvas.readableShare < threshold.minReadableShare) failures.push(`readableShare ${canvas.readableShare.toFixed(3)} < ${threshold.minReadableShare}`);
  if (canvas.p90VisibleLuma < threshold.minP90VisibleLuma) failures.push(`p90VisibleLuma ${canvas.p90VisibleLuma} < ${threshold.minP90VisibleLuma}`);
  if (canvas.occupiedWidthRatio < threshold.minOccupiedWidthRatio) failures.push(`occupiedWidthRatio ${canvas.occupiedWidthRatio.toFixed(3)} < ${threshold.minOccupiedWidthRatio}`);
  if (canvas.occupiedHeightRatio < threshold.minOccupiedHeightRatio) failures.push(`occupiedHeightRatio ${canvas.occupiedHeightRatio.toFixed(3)} < ${threshold.minOccupiedHeightRatio}`);
  if (canvas.occupiedTiles < threshold.minOccupiedTiles) failures.push(`occupiedTiles ${canvas.occupiedTiles} < ${threshold.minOccupiedTiles}`);
  return failures;
}

function handoffGeometryBrowserExpression(): string {
  return `(() => {
    const headline = document.querySelector('[data-scene="hand"] h2');
    const headlineBounds = headline?.getBoundingClientRect() ?? null;
    const measure = document.createElement('canvas').getContext('2d');
    if (measure) measure.font = '500 11.5px ui-monospace, monospace';
    const labelWidth = Math.ceil(measure?.measureText('SHARED MEMORY').width ?? 104);
    const labelBaseline = innerHeight * 0.31;
    const labelRect = {
      left: innerWidth * 0.5 - labelWidth * 0.5 - 4,
      top: labelBaseline - 13,
      right: innerWidth * 0.5 + labelWidth * 0.5 + 4,
      bottom: labelBaseline + 4,
    };
    const headlineRect = headlineBounds ? {
      left: headlineBounds.left,
      top: headlineBounds.top,
      right: headlineBounds.right,
      bottom: headlineBounds.bottom,
    } : null;
    const overlap = headlineRect !== null
      && labelRect.left < headlineRect.right
      && labelRect.right > headlineRect.left
      && labelRect.top < headlineRect.bottom
      && labelRect.bottom > headlineRect.top;
    const verticalGapPx = headlineRect === null
      ? -1
      : labelRect.top - headlineRect.bottom;
    const labelInsideViewport = labelRect.left >= 0
      && labelRect.top >= 0
      && labelRect.right <= innerWidth
      && labelRect.bottom <= innerHeight;
    return {
      headlineRect,
      canvasLabelRect: labelRect,
      overlap,
      verticalGapPx,
      labelInsideViewport,
      ok: headlineRect !== null && !overlap && verticalGapPx >= 12 && labelInsideViewport,
    };
  })()`;
}

function packFrameBrowserExpression(): string {
  return `JSON.stringify((() => {
    const canvas = document.querySelector('canvas');
    const progress = Number(canvas?.getAttribute('data-active-progress') ?? 0);
    const clamp = (value) => Math.max(0, Math.min(1, value));
    const eased = (value) => { const v = clamp(value); return v * v * (3 - 2 * v); };
    const slide = eased(clamp((progress - 0.8) * 5));
    const minimum = Math.min(innerWidth, innerHeight);
    const center = {
      x: innerWidth * 0.44 + slide * innerWidth * 0.14,
      y: innerHeight * 0.55,
      radius: Math.max(innerWidth < 760 ? 34 : 48, minimum * 0.07),
      progress,
    };
    const empty = {
      labelReadablePixels: 0,
      labelBrightPixels: 0,
      labelAmberPixels: 0,
      outerReadablePixels: 0,
      outerBrightPixels: 0,
      coreReadablePixels: 0,
    };
    if (!canvas || canvas.width < 1 || canvas.height < 1) return { center, regions: empty };
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { center, regions: empty };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scan = (left, top, right, bottom) => {
      const x0 = Math.max(0, Math.floor(left));
      const y0 = Math.max(0, Math.floor(top));
      const x1 = Math.min(canvas.width, Math.ceil(right));
      const y1 = Math.min(canvas.height, Math.ceil(bottom));
      let readable = 0;
      let bright = 0;
      let amber = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const alpha = pixels[offset + 3] / 255;
          if (alpha <= 0) continue;
          const red = pixels[offset] * alpha;
          const green = pixels[offset + 1] * alpha;
          const blue = pixels[offset + 2] * alpha;
          const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
          if (luma >= 36) readable += 1;
          if (luma >= 72) bright += 1;
          if (red >= 90 && green >= 40 && blue <= 70 && red >= green * 1.25 && green >= blue * 1.45) amber += 1;
        }
      }
      return { readable, bright, amber };
    };
    const labelBaseline = center.y - center.radius - 12;
    const label = scan(center.x - 165, labelBaseline - 16, center.x + 165, labelBaseline + 6);
    const offsets = [[-0.09, -0.07], [0.09, -0.07], [-0.09, 0.07], [0.09, 0.07]];
    let outerReadablePixels = 0;
    let outerBrightPixels = 0;
    for (const offset of offsets) {
      const x = center.x + offset[0] * minimum;
      const y = center.y + offset[1] * minimum;
      const region = scan(x - 38, y - 32, x + 38, y + 32);
      outerReadablePixels += region.readable;
      outerBrightPixels += region.bright;
    }
    const core = scan(center.x - 40, center.y - 36, center.x + 40, center.y + 36);
    return {
      center,
      regions: {
        labelReadablePixels: label.readable,
        labelBrightPixels: label.bright,
        labelAmberPixels: label.amber,
        outerReadablePixels,
        outerBrightPixels,
        coreReadablePixels: core.readable,
      },
    };
  })())`;
}

function browserReadingExpression(): string {
  return `JSON.stringify((() => {
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const painted = typeof el.checkVisibility === 'function'
        ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
        : style.display !== 'none' && style.visibility !== 'hidden';
      return painted && rect.width > 0 && rect.height > 0;
    };
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
    const missingAnchors = [...document.querySelectorAll('header a[href^="#"]')]
      .map((a) => a.getAttribute('href'))
      .filter((href) => href && !document.querySelector(href));
    const canvas = document.querySelector('canvas');
    let canvasInkSamples = 0;
    if (canvas && canvas.width > 0 && canvas.height > 0) {
      try {
        const context = canvas.getContext('2d');
        // The approved field is intentionally sparse at wide viewports. Sample
        // densely enough to distinguish that restraint from an actually blank
        // canvas without requiring the design to become visually noisy.
        for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 36))) {
          for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 64))) {
            const pixel = context.getImageData(x, y, 1, 1).data;
            if (pixel[3] > 0 && (pixel[0] + pixel[1] + pixel[2]) > 12) canvasInkSamples += 1;
          }
        }
      } catch {}
    }
    const header = document.querySelector('header');
    const menu = document.querySelector('[data-navmenu] > summary');
    const hero = document.querySelector('#top');
    const heroHeadline = hero?.querySelector('h1') ?? null;
    const heroCopy = hero?.querySelector('p') ?? null;
    const heroContent = hero?.querySelector('[data-shield]') ?? null;
    const heroActions = hero
      ? [...hero.querySelectorAll('button, a')].filter((element) => visible(element))
      : [];
    const fullyInsideViewport = (element, inset = 0) => {
      if (!visible(element)) return false;
      const rect = element.getBoundingClientRect();
      return rect.top >= inset
        && rect.left >= 0
        && rect.bottom <= innerHeight
        && rect.right <= innerWidth;
    };
    const heroContentRect = heroContent?.getBoundingClientRect() ?? null;
    const heroContentOverflowPx = heroContentRect
      ? Math.max(
        0,
        Math.ceil(-heroContentRect.top),
        Math.ceil(heroContentRect.bottom - innerHeight),
        Math.ceil(-heroContentRect.left),
        Math.ceil(heroContentRect.right - innerWidth),
      )
      : Number.POSITIVE_INFINITY;
    const unnamedButtonNodes = [...document.querySelectorAll('button')].filter((button) => {
      const name = String(button.innerText || button.getAttribute('aria-label') || button.getAttribute('title') || '').trim();
      return visible(button) && name.length === 0;
    });
    return {
      textLength: (document.body.innerText || '').trim().length,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      sceneCount: document.querySelectorAll('[data-scene]').length,
      uniqueScenes: new Set([...document.querySelectorAll('[data-scene]')].map((el) => el.getAttribute('data-scene'))).size,
      chapterCount: document.querySelectorAll('[data-chapter]').length,
      uniqueChapters: new Set([...document.querySelectorAll('[data-chapter]')].map((el) => el.getAttribute('data-chapter'))).size,
      duplicateIds,
      unnamedButtons: unnamedButtonNodes.length,
      unnamedButtonSnippets: unnamedButtonNodes.map((button) => button.outerHTML.slice(0, 240)),
      missingAnchors,
      canvasPresent: canvas !== null,
      canvasInkSamples,
      canvasReadability: ${canvasReadabilityBrowserExpression()},
      activeCanvasScene: canvas?.getAttribute('data-active-scene') ?? null,
      heroApertureVisible: visible(document.querySelector('.hero-aperture')),
      journeyVisible: visible(document.querySelector('.memory-journey')),
      headerPosition: header ? getComputedStyle(header).position : 'missing',
      brandVisible: visible(document.querySelector('header a[href="#top"]')),
      mobileMenuVisible: visible(menu),
      mobileMenuTouchHeight: menu ? Math.round(menu.getBoundingClientRect().height) : 0,
      mainPresent: document.querySelector('main#main-content') !== null,
      skipLinkPresent: document.querySelector('a[href="#main-content"]') !== null,
      heroHeadlineFullyVisible: fullyInsideViewport(heroHeadline),
      heroActionsFullyVisible: heroActions.length >= 3 && heroActions.every((element) => fullyInsideViewport(element)),
      heroMainCopyFits: fullyInsideViewport(heroCopy)
        && heroCopy.scrollWidth <= heroCopy.clientWidth + 1
        && heroCopy.scrollHeight <= heroCopy.clientHeight + 1,
      heroContentFullyVisible: fullyInsideViewport(heroContent),
      heroContentOverflowPx,
    };
  })())`;
}

async function evaluateJson<T>(devtools: Devtools, expression: string): Promise<T> {
  const result = await devtools.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  }) as { result?: { value?: string } };
  return JSON.parse(result.result?.value ?? '{}') as T;
}

async function screenshot(devtools: Devtools, path: string): Promise<string> {
  const capture = await devtools.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    fromSurface: true,
  }) as { data: string };
  const bytes = Buffer.from(capture.data, 'base64');
  writeFileSync(path, bytes);
  return createHash('sha256').update(bytes).digest('hex');
}

async function waitForLanding(devtools: Devtools, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluateJson<{ ready: boolean }>(devtools, `JSON.stringify({
      ready: (document.body?.innerText || '').trim().length > 1000
        && document.querySelectorAll('[data-chapter]').length === 13
        && document.querySelector('canvas') !== null,
    })`);
    if (ready.ready) return;
    await wait(100);
  }
  fail('landing did not become ready before the browser deadline');
}

try {
  const probe = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(8_000) });
  if (!probe.ok) fail(`${BASE} answered ${probe.status}`);
} catch {
  fail(`nothing answering at ${BASE}`);
}

mkdirSync(OUT, { recursive: true });
const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-v10-landing-'));
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
const findings: ViewportFinding[] = [];
const stageHashes = new Map<string, string>();
const stageStates = new Map<string, string | null>();
const stageReadings = new Map<StageName, StageReading>();
const mobileStageHashes = new Map<string, string>();
const mobileStageReadings = new Map<string, MobileStageReading>();
let packInteraction: PackInteractionReading | null = null;
let consoleErrors: string[] = [];
let exceptions: string[] = [];
let failedRequests: string[] = [];

try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Runtime.enable');
  await devtools.send('Network.enable');

  devtools.on('Runtime.consoleAPICalled', (params) => {
    const call = params as { type?: string; args?: { value?: unknown; description?: string }[] };
    if (call.type !== 'error') return;
    consoleErrors.push((call.args ?? []).map((arg) => String(arg.value ?? arg.description ?? '')).join(' ').trim());
  });
  devtools.on('Runtime.exceptionThrown', (params) => {
    const thrown = params as { exceptionDetails?: { text?: string; exception?: { description?: string } } };
    exceptions.push(thrown.exceptionDetails?.exception?.description ?? thrown.exceptionDetails?.text ?? 'browser exception');
  });
  devtools.on('Network.loadingFailed', (params) => {
    const failure = params as { canceled?: boolean; errorText?: string; type?: string };
    if (failure.canceled !== true) failedRequests.push(`${failure.type ?? 'request'}: ${failure.errorText ?? 'failed'}`);
  });
  devtools.on('Network.responseReceived', (params) => {
    const response = (params as { response?: { status?: number; url?: string } }).response;
    if ((response?.status ?? 0) >= 400) failedRequests.push(`${response?.status} ${response?.url ?? ''}`);
  });

  for (const viewport of VIEWPORTS) {
    consoleErrors = [];
    exceptions = [];
    failedRequests = [];
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: viewport.mobile,
    });
    await devtools.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [
        { name: 'prefers-color-scheme', value: 'dark' },
        { name: 'prefers-reduced-motion', value: 'no-preference' },
      ],
    });
    const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
    await devtools.send('Page.navigate', { url: `${BASE}/` });
    await loaded;
    await waitForLanding(devtools);
    // The final hero line enters after a one-second delay; capture the fully
    // composed state instead of grading the middle of its entrance.
    await wait(1_650);

    const reading = await evaluateJson<BrowserReading>(devtools, browserReadingExpression());
    const file = `${OUT}/hero-${viewport.name}.png`;
    await screenshot(devtools, file);
    const mobileMenuOk = !viewport.mobile
      || (reading.mobileMenuVisible && reading.mobileMenuTouchHeight >= 44);
    const heroCanvasThreshold = viewport.mobile
      ? READABILITY_THRESHOLDS.sparse
      : READABILITY_THRESHOLDS.standard;
    const canvasReadabilityFailures = readabilityFailures(reading.canvasReadability, heroCanvasThreshold);
    const shortDesktopHeroFitRequired = viewport.width >= 1_024 && viewport.height <= 900;
    const shortDesktopHeroOk = !shortDesktopHeroFitRequired
      || (reading.heroHeadlineFullyVisible
        && reading.heroActionsFullyVisible
        && reading.heroMainCopyFits
        && reading.heroContentFullyVisible
        && reading.heroContentOverflowPx === 0);
    const visualOk = reading.textLength > 1_000
      && reading.overflow === 0
      && reading.sceneCount >= 10
      && reading.uniqueScenes >= 10
      && reading.chapterCount === 13
      && reading.uniqueChapters === 13
      && reading.duplicateIds.length === 0
      && reading.unnamedButtons === 0
      && reading.missingAnchors.length === 0
      && reading.canvasPresent
      && canvasReadabilityFailures.length === 0
      && reading.activeCanvasScene === 'hero'
      && !reading.heroApertureVisible
      && !reading.journeyVisible
      && reading.headerPosition === 'fixed'
      && reading.brandVisible
      && reading.mainPresent
      && reading.skipLinkPresent
      && shortDesktopHeroOk
      && mobileMenuOk;
    const finding: ViewportFinding = {
      ...reading,
      viewport: viewport.name,
      canvasReadabilityFailures,
      shortDesktopHeroFitRequired,
      consoleErrors: [...consoleErrors],
      exceptions: [...exceptions],
      failedRequests: [...failedRequests],
      screenshot: file,
      visualOk,
      ok: visualOk
        && consoleErrors.length === 0
        && exceptions.length === 0
        && failedRequests.length === 0,
    };
    findings.push(finding);
    process.stdout.write(`${finding.ok ? 'ok  ' : 'FAIL'} ${viewport.name} overflow=${reading.overflow} scenes=${reading.sceneCount} readable=${reading.canvasReadability.readablePixels} bright=${reading.canvasReadability.brightPixels} heroOverflow=${reading.heroContentOverflowPx}\n`);
  }

  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 1_440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await devtools.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  const loaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  await devtools.send('Page.navigate', { url: `${BASE}/` });
  await loaded;
  await waitForLanding(devtools);
  await wait(600);

  for (const [name, selector, expectedScene] of STAGES) {
    const positioned = await evaluateJson<{ ok: boolean; scene: string | null }>(devtools, `JSON.stringify((() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false, scene: null };
      const top = element.getBoundingClientRect().top + scrollY;
      const range = Math.max(0, element.getBoundingClientRect().height - innerHeight);
      // Grade a composed, information-bearing state. Earlier progress points
      // remain covered by motion capture; 0.64 is late enough for labels and
      // relationships to be present without grading only the final frame.
      scrollTo({ top: top + range * 0.64, behavior: 'instant' });
      return { ok: true, scene: element.getAttribute('data-scene') };
    })())`);
    if (!positioned.ok) {
      process.stdout.write(`MISS stage ${name} selector ${selector}\n`);
      continue;
    }
    // A direct automation jump crosses several narrative chapters at once.
    // Give the persistent particle field enough frames to reach the semantic
    // target that a human scroll would have approached continuously.
    const sceneDeadline = Date.now() + 4_000;
    let active = { scene: null as string | null, progress: 0 };
    while (Date.now() < sceneDeadline) {
      active = await evaluateJson<{ scene: string | null; progress: number }>(devtools, `JSON.stringify((() => ({
        scene: document.querySelector('canvas')?.getAttribute('data-active-scene') ?? null,
        progress: Number(document.querySelector('canvas')?.getAttribute('data-active-progress') ?? 0),
      }))())`);
      if (active.scene === expectedScene && active.progress >= 0.58) break;
      await wait(100);
    }
    // Let the persistent field finish its visual interpolation after the
    // semantic scene/progress contract says the target has been reached.
    await wait(1_150);
    const browserStage = await evaluateJson<{
      scene: string | null;
      progress: number;
      canvas: CanvasReadability;
      speed: Omit<SpeedReading, 'ok'>;
      handoff: HandoffGeometry;
    }>(devtools, `JSON.stringify((() => {
      const canvas = document.querySelector('canvas');
      const speedElement = document.querySelector('[data-scene="speed"]');
      const speedText = String(speedElement?.innerText || '').replace(/\\s+/g, ' ').trim();
      const numericMsValues = [...speedText.matchAll(/\\b(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?\\s*MS\\b/gi)].map((match) => match[0]);
      const placeholderMsValues = [...speedText.matchAll(/[—–-]\\s*MS\\b/gi)].map((match) => match[0]);
      return {
        scene: canvas?.getAttribute('data-active-scene') ?? null,
        progress: Number(canvas?.getAttribute('data-active-progress') ?? 0),
        canvas: ${canvasReadabilityBrowserExpression()},
        handoff: ${handoffGeometryBrowserExpression()},
        speed: {
          present: speedElement !== null,
          text: speedText,
          numericMsValues,
          placeholderMsValues,
          endToEndNumeric: /END TO END(?:(?!END TO END).){0,80}?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?\\s*MS\\b/i.test(speedText),
        },
      };
    })())`);
    const profile = STAGE_READABILITY_PROFILE[name];
    const threshold = READABILITY_THRESHOLDS[profile];
    const failures = readabilityFailures(browserStage.canvas, threshold);
    const speed: SpeedReading | null = name === 'context-speed'
      ? {
        ...browserStage.speed,
        ok: browserStage.speed.present
          && browserStage.speed.placeholderMsValues.length === 0
          && browserStage.speed.numericMsValues.length >= 4
          && browserStage.speed.endToEndNumeric,
      }
      : null;
    const stageReading: StageReading = {
      activeScene: browserStage.scene,
      activeProgress: browserStage.progress,
      canvas: browserStage.canvas,
      profile,
      threshold,
      readabilityFailures: failures,
      readable: failures.length === 0,
      speed,
      handoff: name === 'handoff' ? browserStage.handoff : null,
    };
    stageReadings.set(name, stageReading);
    stageStates.set(name, browserStage.scene);
    const file = `${OUT}/stage-${name}-1440.png`;
    stageHashes.set(name, await screenshot(devtools, file));
    if (name === 'context-pack') {
      const baseline = await evaluateJson<{ center: PackInteractionReading['center']; regions: PackRegionReading }>(devtools, packFrameBrowserExpression());
      const baselineHash = stageHashes.get(name) ?? '';
      await devtools.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: baseline.center.x,
        y: baseline.center.y,
      });
      await wait(320);
      const hover = await evaluateJson<{ center: PackInteractionReading['center']; regions: PackRegionReading }>(devtools, packFrameBrowserExpression());
      const hoverHash = await screenshot(devtools, `${OUT}/stage-context-pack-hover-1440.png`);
      await devtools.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: baseline.center.x,
        y: baseline.center.y,
        button: 'left',
        clickCount: 1,
      });
      await devtools.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: baseline.center.x,
        y: baseline.center.y,
        button: 'left',
        clickCount: 1,
      });
      await wait(760);
      const expanded = await evaluateJson<{ center: PackInteractionReading['center']; regions: PackRegionReading }>(devtools, packFrameBrowserExpression());
      const expandedHash = await screenshot(devtools, `${OUT}/stage-context-pack-expanded-1440.png`);
      const hoverLabelReadableDelta = hover.regions.labelReadablePixels - baseline.regions.labelReadablePixels;
      const expandedAmberDelta = expanded.regions.labelAmberPixels - baseline.regions.labelAmberPixels;
      const expandedOuterReadableDelta = expanded.regions.outerReadablePixels - baseline.regions.outerReadablePixels;
      const hoverChanged = hoverHash !== baselineHash && hoverLabelReadableDelta >= 20;
      const expandedChanged = expandedHash !== baselineHash
        && expandedHash !== hoverHash
        && expandedAmberDelta >= 6
        && expandedOuterReadableDelta >= 80;
      packInteraction = {
        center: baseline.center,
        baseline: baseline.regions,
        hover: hover.regions,
        expanded: expanded.regions,
        baselineHash,
        hoverHash,
        expandedHash,
        hoverLabelReadableDelta,
        expandedAmberDelta,
        expandedOuterReadableDelta,
        hoverChanged,
        expandedChanged,
        ok: hoverChanged && expandedChanged,
      };
      await devtools.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    }
    process.stdout.write(`shot ${name} (${browserStage.scene ?? 'none'}${browserStage.scene === expectedScene ? '' : `, expected ${expectedScene}`}) readable=${browserStage.canvas.readablePixels} bright=${browserStage.canvas.brightPixels} share=${browserStage.canvas.readableShare.toFixed(3)} tiles=${browserStage.canvas.occupiedTiles}${failures.length > 0 ? ` FAIL ${failures.join('; ')}` : ''}${speed && !speed.ok ? ` FAIL speed numeric=${speed.numericMsValues.length} placeholders=${speed.placeholderMsValues.length}` : ''}\n`);
  }

  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  const mobileLoaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  await devtools.send('Page.navigate', { url: `${BASE}/` });
  await mobileLoaded;
  await waitForLanding(devtools);
  await wait(600);

  for (const [name, selector, expectedScene] of MOBILE_STAGES) {
    const positioned = await evaluateJson<{ ok: boolean }>(devtools, `JSON.stringify((() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return { ok: false };
      const top = element.getBoundingClientRect().top + scrollY;
      const range = Math.max(0, element.getBoundingClientRect().height - innerHeight);
      scrollTo({ top: top + range * 0.64, behavior: 'instant' });
      return { ok: true };
    })())`);
    if (!positioned.ok) {
      process.stdout.write(`MISS mobile stage ${name} selector ${selector}\n`);
      continue;
    }
    const mobileSceneDeadline = Date.now() + 4_000;
    while (Date.now() < mobileSceneDeadline) {
      const active = await evaluateJson<{ scene: string | null; progress: number }>(devtools, `JSON.stringify((() => ({
        scene: document.querySelector('canvas')?.getAttribute('data-active-scene') ?? null,
        progress: Number(document.querySelector('canvas')?.getAttribute('data-active-progress') ?? 0),
      }))())`);
      if (active.scene === expectedScene && active.progress >= 0.58) break;
      await wait(100);
    }
    await wait(1_150);
    const browserMobile = await evaluateJson<{
      activeScene: string | null;
      activeProgress: number;
      canvas: CanvasReadability;
      pageOverflow: number;
      sceneVisible: boolean;
      packList: MobileStageReading['packList'];
      handoff: HandoffGeometry;
    }>(devtools, `JSON.stringify((() => {
      const canvas = document.querySelector('canvas');
      const scene = document.querySelector(${JSON.stringify(selector)});
      const sceneRect = scene?.getBoundingClientRect() ?? null;
      const visible = (element) => {
        if (!element) return false;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && Number(style.opacity) > 0.9
          && rect.width > 0
          && rect.height > 0;
      };
      const packList = document.querySelector('.pack-list');
      const packRect = packList?.getBoundingClientRect() ?? null;
      const progress = Number(canvas?.getAttribute('data-active-progress') ?? 0);
      const clamp = (value) => Math.max(0, Math.min(1, value));
      const eased = (value) => { const v = clamp(value); return v * v * (3 - 2 * v); };
      const slide = eased(clamp((progress - 0.8) * 5));
      const coreX = innerWidth * 0.44 + slide * innerWidth * 0.14;
      const coreY = innerHeight * 0.55;
      const coreRadius = Math.max(innerWidth < 760 ? 34 : 48, Math.min(innerWidth, innerHeight) * 0.07);
      const coreOverlap = packRect !== null
        && packRect.left < coreX + coreRadius
        && packRect.right > coreX - coreRadius
        && packRect.top < coreY + coreRadius
        && packRect.bottom > coreY - coreRadius;
      const packRequired = ${JSON.stringify(name)} === 'context-pack';
      const packVisible = visible(packList);
      const packInside = packRect !== null
        && packRect.left >= 0
        && packRect.top >= 0
        && packRect.right <= innerWidth
        && packRect.bottom <= innerHeight;
      const packItemCount = packList?.querySelectorAll(':scope > span').length ?? 0;
      return {
        activeScene: canvas?.getAttribute('data-active-scene') ?? null,
        activeProgress: progress,
        canvas: ${canvasReadabilityBrowserExpression()},
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        sceneVisible: sceneRect !== null && sceneRect.bottom > 0 && sceneRect.top < innerHeight,
        packList: {
          required: packRequired,
          visible: packVisible,
          insideViewport: packInside,
          itemCount: packItemCount,
          coreOverlap,
          ok: !packRequired || (packVisible && packInside && packItemCount >= 5 && !coreOverlap),
        },
        handoff: ${handoffGeometryBrowserExpression()},
      };
    })())`);
    const failures = readabilityFailures(browserMobile.canvas, READABILITY_THRESHOLDS.mobile);
    const file = `${OUT}/stage-${name}-390.png`;
    const hash = await screenshot(devtools, file);
    const reading: MobileStageReading = {
      activeScene: browserMobile.activeScene,
      activeProgress: browserMobile.activeProgress,
      canvas: browserMobile.canvas,
      readabilityFailures: failures,
      readable: failures.length === 0,
      pageOverflow: browserMobile.pageOverflow,
      sceneVisible: browserMobile.sceneVisible,
      packList: browserMobile.packList,
      handoff: name === 'handoff' ? browserMobile.handoff : null,
      screenshot: file,
    };
    mobileStageHashes.set(name, hash);
    mobileStageReadings.set(name, reading);
    process.stdout.write(`mobile ${name} (${browserMobile.activeScene ?? 'none'}${browserMobile.activeScene === expectedScene ? '' : `, expected ${expectedScene}`}) readable=${browserMobile.canvas.readablePixels} bright=${browserMobile.canvas.brightPixels} overflow=${browserMobile.pageOverflow}${failures.length > 0 ? ` FAIL ${failures.join('; ')}` : ''}${!browserMobile.packList.ok ? ' FAIL pack-list' : ''}${name === 'handoff' && !browserMobile.handoff.ok ? ` FAIL handoff-gap=${browserMobile.handoff.verticalGapPx.toFixed(1)}` : ''}\n`);
  }

  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 1_440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await devtools.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
  const reducedLoaded = devtools.once('Page.loadEventFired', LOAD_TIMEOUT_MS);
  await devtools.send('Page.navigate', { url: `${BASE}/` });
  await reducedLoaded;
  await waitForLanding(devtools);
  await wait(500);
  const reduced = await evaluateJson<{
    textLength: number;
    overflow: number;
    visibleFx: number;
    totalFx: number;
  }>(devtools, `JSON.stringify((() => {
    const fx = [...document.querySelectorAll('[data-fx]')];
    return {
      textLength: (document.body.innerText || '').trim().length,
      overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      visibleFx: fx.filter((el) => Number(getComputedStyle(el).opacity) > 0.9).length,
      totalFx: fx.length,
    };
  })())`);

  const uniqueStageFrames = new Set(stageHashes.values()).size;
  const missingStages = STAGES.map(([name]) => name).filter((name) => !stageHashes.has(name));
  const mismatchedStageStates = STAGES
    .filter(([name, , expectedScene]) => stageStates.get(name) !== expectedScene)
    .map(([name, , expectedScene]) => ({ name, expectedScene, activeScene: stageStates.get(name) ?? null }));
  const unreadableStages = STAGES
    .map(([name]) => ({ name, reading: stageReadings.get(name) }))
    .filter((entry) => entry.reading !== undefined && !entry.reading.readable)
    .map((entry) => ({ name: entry.name, failures: entry.reading?.readabilityFailures ?? [] }));
  const speedReading = stageReadings.get('context-speed')?.speed ?? null;
  const desktopHandoff = stageReadings.get('handoff')?.handoff ?? null;
  const uniqueMobileStageFrames = new Set(mobileStageHashes.values()).size;
  const missingMobileStages = MOBILE_STAGES
    .map(([name]) => name)
    .filter((name) => !mobileStageReadings.has(name));
  const mismatchedMobileStageStates = MOBILE_STAGES
    .filter(([name, , expectedScene]) => mobileStageReadings.get(name)?.activeScene !== expectedScene)
    .map(([name, , expectedScene]) => ({
      name,
      expectedScene,
      activeScene: mobileStageReadings.get(name)?.activeScene ?? null,
    }));
  const failedMobileStages = MOBILE_STAGES
    .map(([name]) => ({ name, reading: mobileStageReadings.get(name) }))
    .filter(({ reading }) => reading !== undefined && (
      !reading.readable
      || reading.pageOverflow !== 0
      || !reading.sceneVisible
      || !reading.packList.ok
      || (reading.handoff !== null && !reading.handoff.ok)
    ))
    .map(({ name, reading }) => ({
      name,
      readabilityFailures: reading?.readabilityFailures ?? [],
      pageOverflow: reading?.pageOverflow ?? null,
      sceneVisible: reading?.sceneVisible ?? false,
      packListOk: reading?.packList.ok ?? false,
      handoffOk: reading?.handoff?.ok ?? null,
    }));
  const mobileStageClean = missingMobileStages.length === 0
    && mismatchedMobileStageStates.length === 0
    && failedMobileStages.length === 0
    && uniqueMobileStageFrames >= MOBILE_STAGES.length - 1;
  const stagePngFiles = readdirSync(OUT)
    .filter((name) => /^stage-.*\.png$/i.test(name))
    .sort();
  const staleStagePngs = stagePngFiles.filter((name) => !EXPECTED_STAGE_PNGS.has(name));
  const missingManifestStagePngs = [...EXPECTED_STAGE_PNGS]
    .filter((name) => !stagePngFiles.includes(name));
  const stagePngManifestClean = staleStagePngs.length === 0
    && missingManifestStagePngs.length === 0;
  const stageClean = missingStages.length === 0
    && mismatchedStageStates.length === 0
    && unreadableStages.length === 0
    && speedReading?.ok === true
    && desktopHandoff?.ok === true
    && packInteraction?.ok === true
    && mobileStageClean
    && stagePngManifestClean
    && uniqueStageFrames >= Math.max(10, stageHashes.size - 2);
  const reducedMotionClean = reduced.textLength > 1_000
    && reduced.overflow === 0
    && reduced.visibleFx === reduced.totalFx;
  const visualClean = findings.every((finding) => finding.visualOk)
    && stageClean
    && reducedMotionClean;
  const networkClean = findings.every((finding) => finding.consoleErrors.length === 0
    && finding.exceptions.length === 0
    && finding.failedRequests.length === 0);
  const report = {
    recorded: new Date().toISOString(),
    base: BASE,
    approvedDesign: {
      rejectedApertureAbsent: findings.every((finding) => !finding.heroApertureVisible),
      rejectedJourneyAbsent: findings.every((finding) => !finding.journeyVisible),
      uniqueStageFrames,
      capturedStageFrames: stageHashes.size,
      missingStages,
      stageStates: Object.fromEntries(stageStates),
      mismatchedStageStates,
      readabilityThresholds: READABILITY_THRESHOLDS,
      stageReadings: Object.fromEntries(stageReadings),
      unreadableStages,
      speed: speedReading,
      packInteraction,
      handoff: {
        desktop: desktopHandoff,
        mobile: mobileStageReadings.get('handoff')?.handoff ?? null,
      },
      mobile: {
        viewport: '390x844',
        capturedStageFrames: mobileStageHashes.size,
        uniqueStageFrames: uniqueMobileStageFrames,
        missingStages: missingMobileStages,
        mismatchedStageStates: mismatchedMobileStageStates,
        failedStages: failedMobileStages,
        stageReadings: Object.fromEntries(mobileStageReadings),
        clean: mobileStageClean,
      },
      stagePngManifest: {
        expected: [...EXPECTED_STAGE_PNGS].sort(),
        found: stagePngFiles,
        stale: staleStagePngs,
        missing: missingManifestStagePngs,
        clean: stagePngManifestClean,
      },
    },
    reducedMotion: {
      ...reduced,
      ok: reducedMotionClean,
    },
    viewports: findings,
    visualClean,
    networkClean,
    clean: visualClean && networkClean,
  };
  writeFileSync(`${OUT}/landing-audit.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nstage frames ${stageHashes.size}, unique ${uniqueStageFrames}, missing ${missingStages.length}\n`);
  process.stdout.write(`unreadable stages ${unreadableStages.length}; speed values ${speedReading?.numericMsValues.length ?? 0}, placeholders ${speedReading?.placeholderMsValues.length ?? 0}\n`);
  process.stdout.write(`pack interaction ${packInteraction?.ok === true ? 'ok' : 'FAIL'}; handoff desktop ${desktopHandoff?.ok === true ? 'ok' : 'FAIL'}; mobile stages ${mobileStageHashes.size}/${MOBILE_STAGES.length}, unique ${uniqueMobileStageFrames}, failed ${failedMobileStages.length}\n`);
  process.stdout.write(`stage PNG manifest stale ${staleStagePngs.length}, missing ${missingManifestStagePngs.length}\n`);
  process.stdout.write(`reduced motion fx ${reduced.visibleFx}/${reduced.totalFx}\n`);
  process.stdout.write(`LANDING_VISUAL_AUDIT_CLEAN: ${report.clean}\n`);
  if (!report.clean) process.exitCode = 1;
} finally {
  devtools?.close();
  if (process.platform === 'win32' && browser.pid !== undefined) {
    // Chrome is a process tree on Windows. Killing only the bootstrap process
    // can leave the renderer holding the temporary profile and this audit open.
    // The PID is the exact child spawned above; no ambient browser is targeted.
    spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    browser.kill('SIGKILL');
  }
  browser.unref();
  await wait(400);
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  } catch {
    process.stderr.write(`temporary Chrome profile remains at ${profile}\n`);
  }
}
