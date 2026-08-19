import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

/**
 * Render one social card at two sizes.
 *
 *   npx tsx scripts/social-card.ts social/day7
 *
 * `scripts/screens.ts` drives Chrome over the debugging protocol because the
 * set it captures needs a colour scheme, needs to shoot past the fold, and
 * needs a density check to catch an empty frame. A social card needs none of
 * those: it is a fixed rectangle with the ground painted into the document, and
 * the whole card is above the fold by construction. So this uses the screenshot
 * flag and spends its care on reading the result back instead.
 *
 * The card is read back off disk either way. The PNG header is parsed for the
 * real pixel dimensions and the file is checked against a floor for its area,
 * because the failure that matters here is a card that renders as a black
 * rectangle when a font or a stylesheet does not load, and a black rectangle is
 * a small file.
 */

const CHROME = [
  process.env['CHROME'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((path): path is string => path !== undefined && existsSync(path));

if (CHROME === undefined) {
  process.stderr.write('no Chrome found. Set CHROME to the executable and run this again.\n');
  process.exit(2);
}

const dir = process.argv[2];
if (dir === undefined) {
  process.stderr.write('usage: tsx scripts/social-card.ts <directory holding source.html>\n');
  process.exit(2);
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const source = join(ROOT, dir, 'source.html');
if (!existsSync(source)) {
  process.stderr.write(`no source.html in ${dir}\n`);
  process.exit(2);
}

interface Size {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  /** Scales every length in the card, so one document serves both shapes. */
  readonly vars: Record<string, string>;
}

const SIZES: readonly Size[] = [
  {
    file: 'image-1080x1350.png',
    width: 1_080,
    height: 1_350,
    vars: {
      '--w': '1080px', '--h': '1350px', '--pad': '68px',
      '--mark': '32px', '--word': '43px', '--kick': '16px',
      '--code': '22px', '--line': '15px', '--gap': '36px',
    },
  },
  {
    file: 'image-1600x900.png',
    width: 1_600,
    height: 900,
    // Sixteen by nine is short. The same transcript needs smaller type here
    // rather than fewer lines, because dropping a block to make it fit would
    // be cropping away the evidence the card exists to show.
    vars: {
      '--w': '1600px', '--h': '900px', '--pad': '48px',
      '--mark': '21px', '--word': '31px', '--kick': '12px',
      '--code': '17px', '--line': '10px', '--gap': '20px',
    },
  },
];

/** Width and height out of the IHDR chunk, which is always the first one. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const signature = bytes.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('not a PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * The row of the last pixel that is not the black ground.
 *
 * This exists because of a real failure. The card was a flex column with the
 * transcript set to grow, and when the transcript was taller than its share the
 * closing rule and the provenance line were pushed past the fixed height, where
 * `overflow: hidden` deleted them. Chrome exited zero, the PNG was the right
 * size, and the card looked finished. Only counting ink found it.
 */
function lastInkRow(bytes: Buffer): number {
  let at = 8;
  let width = 0;
  let height = 0;
  let colour = 0;
  const parts: Buffer[] = [];

  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colour = data[9]!;
    }
    if (type === 'IDAT') parts.push(data);
    at += 12 + length;
  }

  const channels = colour === 6 ? 4 : colour === 2 ? 3 : 1;
  if (channels === 1) throw new Error('the card rendered without colour channels');

  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const image = Buffer.alloc(height * stride);
  let read = 0;
  let last = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[read]!;
    read += 1;
    const line = raw.subarray(read, read + stride);
    read += stride;
    const row = Buffer.alloc(stride);

    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels]! : 0;
      const up = y > 0 ? image[(y - 1) * stride + i]! : 0;
      const corner = y > 0 && i >= channels ? image[(y - 1) * stride + i - channels]! : 0;
      let value = line[i]!;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const guess = left + up - corner;
        const dl = Math.abs(guess - left);
        const du = Math.abs(guess - up);
        const dc = Math.abs(guess - corner);
        value += dl <= du && dl <= dc ? left : du <= dc ? up : corner;
      }
      row[i] = value & 255;
    }

    row.copy(image, y * stride);
    for (let x = 0; x < width; x += 1) {
      if (row[x * channels]! > 24 || row[x * channels + 1]! > 24 || row[x * channels + 2]! > 24) {
        last = y;
        break;
      }
    }
  }

  return last;
}

// Chrome writes the capture straight into the destination directory. A
// temporary directory would be tidier, except the scratch drive and the
// repository are different volumes here and rename does not cross one.
const work = mkdtempSync(join(tmpdir(), 'lacuna-card-'));
const out = join(ROOT, dir);
mkdirSync(out, { recursive: true });
const html = readFileSync(source, 'utf8');

for (const size of SIZES) {
  const vars = Object.entries(size.vars).map(([name, value]) => `${name}:${value}`).join(';');
  const page = html.replace('<style>', `<style>\n  :root { ${vars} }\n`);
  // Beside source.html, not in a temporary directory. The card loads its font
  // by a path relative to itself, and a copy somewhere else silently falls back
  // to whatever monospace the machine has, which is a different card.
  // A unique name each run. Chrome caches file:// URLs, and a stable name meant
  // an edited card rendered byte identical to the previous one.
  const pagePath = join(out, `.render-${size.width}x${size.height}-${Date.now()}.html`);
  writeFileSync(pagePath, page, 'utf8');

  execFileSync(CHROME, [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--default-background-color=000000',
    `--window-size=${size.width},${size.height}`,
    `--screenshot=${join(out, size.file)}`,
    '--virtual-time-budget=4000',
    `file:///${pagePath.replace(/\\/g, '/')}`,
  ], { stdio: 'pipe', timeout: 90_000 });

  const bytes = readFileSync(join(out, size.file));
  const measured = pngSize(bytes);
  if (measured.width !== size.width || measured.height !== size.height) {
    throw new Error(
      `${size.file} is ${measured.width}x${measured.height}, expected ${size.width}x${size.height}`,
    );
  }

  // A card that failed to render is a near uniform rectangle, and a near
  // uniform rectangle compresses to almost nothing. This floor is well under a
  // real card and well over an empty one.
  const floor = Math.round((size.width * size.height) / 400);
  if (bytes.length < floor) {
    throw new Error(`${size.file} is ${bytes.length} bytes, under the ${floor} byte floor for a drawn card`);
  }

  // Two coarse bounds on where the drawing ends.
  //
  // Nothing below 55% means the card lost most of its lower half, which is what
  // happened when the transcript was a growing flex child: the closing rule and
  // the provenance line were pushed past the fixed height and overflow:hidden
  // removed them, while Chrome exited zero and the PNG kept its dimensions.
  // Ink past the padding edge means the opposite failure, a card grown longer
  // than its canvas and cropped.
  //
  // This does not verify that any particular line is present. It catches the
  // shape of the render being wrong, and the card itself is reviewed by eye.
  const ink = lastInkRow(bytes);
  const pad = Number.parseInt(size.vars['--pad'] ?? '0', 10);
  const edge = size.height - pad;
  const floorRow = Math.round(size.height * 0.55);

  if (ink < floorRow) {
    throw new Error(
      `${size.file} draws nothing below row ${ink} of ${size.height}. `
      + 'The lower half of the card is missing.',
    );
  }
  if (ink > edge + 2) {
    throw new Error(`${size.file} draws down to row ${ink}, past the ${edge} padding edge. Clipped.`);
  }

  rmSync(pagePath, { force: true });
  process.stdout.write(
    `${dir}/${size.file}  ${measured.width}x${measured.height}  `
    + `${Math.round(bytes.length / 1024)}kB  last drawn row ${ink} of ${size.height}\n`,
  );
}

rmSync(work, { recursive: true, force: true });
