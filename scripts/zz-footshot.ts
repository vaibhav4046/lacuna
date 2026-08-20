import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Devtools, debuggerUrl, findChrome, freePort, wait } from './lib/devtools.js';

/** One shot of the landing footer, scrolled to the bottom, to check readability. */
const BASE = 'https://lacuna-five.vercel.app';
const OUT = 'D:/project/lacuna/artifacts/screens/footer-check.png';

const chrome = findChrome();
const port = await freePort();
const profile = mkdtempSync(join(tmpdir(), 'lacuna-foot-'));
mkdirSync('D:/project/lacuna/artifacts/screens', { recursive: true });

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
  await devtools.send('Runtime.enable');
  await devtools.send('Emulation.setDeviceMetricsOverride', {
    width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false,
  });
  const loaded = devtools.once('Page.loadEventFired', 30_000);
  await devtools.send('Page.navigate', { url: BASE });
  await loaded;
  await wait(5_000);
  await devtools.send('Runtime.evaluate', {
    expression: 'window.scrollTo(0, document.body.scrollHeight)',
  });
  await wait(3_500);
  const shot = await devtools.send('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false, fromSurface: true,
  }) as { data: string };
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  process.stdout.write(`${OUT}\n`);
} finally {
  devtools?.close();
  browser.kill();
}
