import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Devtools, debuggerUrl, fail, findChrome, freePort, wait } from './lib/devtools.js';

/**
 * The mark as a PNG, for the places that cannot take an SVG.
 *
 * Connector directories want a raster icon at a fixed size, and one of them
 * caps it at ten kilobytes. Rather than draw the mark a second time in some
 * other tool, this renders the favicon that already ships, so the icon in a
 * connector list is the same drawing as the one in a browser tab and cannot
 * drift from it.
 *
 * Chrome does the rasterising because it is already a dependency of the capture
 * scripts and it is the renderer the SVG was drawn against.
 *
 *   npx tsx scripts/mark-png.ts
 */

const SOURCE = 'web/public/favicon.svg';
const OUT = 'web/public/mark-256.png';
const SIZE = 256;
/** One connector directory refuses anything larger. */
const CAP_BYTES = 10_240;

const svg = readFileSync(SOURCE, 'utf8');

/**
 * The mark on its own ground, padded.
 *
 * The favicon fills its whole box because a browser tab is sixteen pixels and
 * every one counts. At 256 the same drawing edge to edge looks cramped, so this
 * insets it, which is what every other icon in a connector list does.
 */
const page = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #000; }
  #frame { width: ${SIZE}px; height: ${SIZE}px; display: grid; place-items: center; background: #000; }
  svg { width: ${Math.round(SIZE * 0.74)}px; height: ${Math.round(SIZE * 0.74)}px; }
  svg rect { fill: none !important; }
</style>
<div id="frame">${svg}</div>`;

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-icon-'));
const html = join(profile, 'icon.html');
writeFileSync(html, page, 'utf8');
mkdirSync('web/public', { recursive: true });

const browser = spawn(chrome, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
  '--force-device-scale-factor=1', 'about:blank',
], { stdio: 'ignore' });

let devtools: Devtools | undefined;
try {
  devtools = await Devtools.open(await debuggerUrl(port));
  await devtools.attach();
  await devtools.send('Page.enable');
  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: SIZE, height: SIZE, deviceScaleFactor: 1, mobile: false,
  });

  const loaded = devtools.once('Page.loadEventFired', 20_000);
  await devtools.send('Page.navigate', { url: `file:///${html.replace(/\\/g, '/')}` });
  await loaded;
  await wait(700);

  const shot = await devtools.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true,
  }) as { data: string };

  const bytes = Buffer.from(shot.data, 'base64');
  // Reported rather than silently accepted: a directory that refuses the upload
  // after the fact is a worse place to find out.
  if (bytes.length > CAP_BYTES) {
    process.stdout.write(`${OUT} is ${bytes.length} bytes, over the ${CAP_BYTES} cap some directories set\n`);
  }
  writeFileSync(OUT, bytes);
  process.stdout.write(`${OUT}  ${SIZE}x${SIZE}  ${bytes.length} bytes\n`);
} catch (error) {
  fail(error instanceof Error ? error.message : 'the icon did not render');
} finally {
  devtools?.close();
  browser.kill();
}
