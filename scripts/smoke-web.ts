/**
 * The gates that stop a white page shipping again.
 *
 * Every one of these is HTTP observable, so this needs no browser and can run
 * anywhere the application is served: the dev server, a preview build, or
 * production. Each gate has a name, and a failure prints the name and what it
 * saw rather than a stack trace, because the point of this file is to answer
 * "what is wrong with the page" in one line.
 *
 * The DOM half of the smoke set — mount, hero visible, canvas first frame, no
 * uncaught errors — is checked in a browser and recorded in the release gate
 * document. It is not here because a fetch cannot see it and pretending
 * otherwise would be a gate that passes while the page is blank.
 *
 *   npm run smoke:web                       checks http://127.0.0.1:3016
 *   npm run smoke:web -- https://host       checks somewhere else
 */

export {};

const DEFAULT_BASE = 'http://127.0.0.1:3016';

interface Gate {
  readonly name: string;
  readonly run: (base: string) => Promise<string | null>;
}

async function status(url: string): Promise<number> {
  try {
    const response = await fetch(url, { redirect: 'manual' });
    return response.status;
  } catch {
    return 0;
  }
}

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.text();
}

/** The same host by its other spelling, so an IPv6-only bind cannot hide. */
function sibling(base: string): string | null {
  if (base.includes('127.0.0.1')) return base.replace('127.0.0.1', 'localhost');
  if (base.includes('localhost')) return base.replace('localhost', '127.0.0.1');
  return null;
}

const GATES: readonly Gate[] = [
  {
    name: 'root answers 200',
    run: async (base) => {
      const code = await status(`${base}/`);
      return code === 200 ? null : `GET / answered ${code === 0 ? 'nothing, the connection was refused' : String(code)}`;
    },
  },
  {
    name: 'root answers on both spellings of the host',
    run: async (base) => {
      const other = sibling(base);
      if (other === null) return null;
      const code = await status(`${other}/`);
      return code === 200 ? null : `GET ${other}/ answered ${code === 0 ? 'nothing, the connection was refused' : String(code)}. A server bound to one address family is a white page on the other.`;
    },
  },
  {
    name: 'the document carries the root element',
    run: async (base) => {
      const html = await text(`${base}/`);
      return html.includes('id="root"') ? null : 'no element with id="root" in the served document';
    },
  },
  {
    name: 'the first paint stylesheet is in the document head',
    run: async (base) => {
      const html = await text(`${base}/`);
      const css = html.indexOf('boot.css');
      if (css < 0) return 'boot.css is not linked, so the page is white until the bundle runs';
      const head = html.indexOf('</head>');
      if (head >= 0 && css > head) return 'boot.css is linked after </head>, which is later than it needs to be';
      // Order against a module script does not matter: those are deferred and
      // do not block the parser or the first paint. A classic script does
      // block, so one of those in front of the stylesheet is a real fault.
      const blocking = /<script(?![^>]*type="module")[^>]*src=/i.exec(html.slice(0, css));
      return blocking === null ? null : `a render blocking script precedes boot.css: ${blocking[0]}`;
    },
  },
  {
    name: 'the first paint stylesheet is served and paints black',
    run: async (base) => {
      const code = await status(`${base}/boot.css`);
      if (code !== 200) return `GET /boot.css answered ${code}`;
      const css = await text(`${base}/boot.css`);
      return /background:\s*#000000/i.test(css) ? null : 'boot.css does not set a black background';
    },
  },
  {
    name: 'the document has a recovery state for a browser without JavaScript',
    run: async (base) => {
      const html = await text(`${base}/`);
      return html.includes('<noscript') ? null : 'no noscript block, so a browser without JavaScript sees an empty page';
    },
  },
  {
    name: 'the favicon is served',
    run: async (base) => {
      const code = await status(`${base}/favicon.svg`);
      return code === 200 ? null : `GET /favicon.svg answered ${code}`;
    },
  },
  {
    name: 'a deep route survives a refresh',
    run: async (base) => {
      const code = await status(`${base}/app/dash`);
      return code === 200 ? null : `GET /app/dash answered ${code}, so a refresh inside the application is a dead end`;
    },
  },
  {
    name: 'the document references an application entry module',
    run: async (base) => {
      const html = await text(`${base}/`);
      return /<script[^>]+type="module"/.test(html) ? null : 'no module script in the served document';
    },
  },
];

const base = (process.argv[2] ?? DEFAULT_BASE).replace(/\/$/, '');
let failed = 0;

for (const gate of GATES) {
  let problem: string | null;
  try {
    problem = await gate.run(base);
  } catch (error) {
    problem = error instanceof Error ? error.message : String(error);
  }
  if (problem === null) {
    process.stdout.write(`PASS  ${gate.name}\n`);
  } else {
    failed += 1;
    process.stdout.write(`FAIL  ${gate.name}\n      ${problem}\n`);
  }
}

process.stdout.write(`\n${GATES.length - failed} of ${GATES.length} gates passed against ${base}\n`);
process.exitCode = failed === 0 ? 0 : 1;
