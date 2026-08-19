import { createServer } from 'node:net';
import { existsSync } from 'node:fs';

/**
 * A command channel to a headless Chrome, and the small amount of process
 * wrangling it takes to get one.
 *
 * This was inside `scripts/screens.ts`, which is where it was written and where
 * the reasoning behind it belongs. It moved here when a second script needed
 * the same channel: `scripts/route-audit.ts` walks every route collecting
 * console errors and failed requests, which is the same protocol, the same
 * start up race and the same correlation table as taking a screenshot, and
 * copying a hundred lines of socket handling to get it would leave two of them
 * to keep in step.
 *
 * Nothing about the behaviour changed in the move.
 */

const CHROME_CANDIDATES = [
  process.env['CHROME'],
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
export function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

export function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate;
  }
  fail('no Chrome found. Set CHROME to the executable and run this again.');
}

/** A port nothing is listening on, handed straight to Chrome. */
export function freePort(): Promise<number> {
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

export function wait(ms: number): Promise<void> {
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
export async function debuggerUrl(port: number): Promise<string> {
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
export class Devtools {
  private readonly socket: WebSocket;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private readonly waiting: { method: string; resolve: () => void }[] = [];
  /**
   * Standing subscriptions, as opposed to the one shot seats above.
   *
   * Taking a screenshot only ever needs to wait for the next load event.
   * Collecting the console needs every message a page produces, including the
   * ones that arrive while nothing is being awaited, so those need a listener
   * that stays attached rather than a promise that resolves once.
   */
  private readonly listeners = new Map<string, ((params: unknown) => void)[]>();
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
      for (const handler of this.listeners.get(message.method) ?? []) {
        handler((message as { params?: unknown }).params);
      }

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

  /** Subscribe to every occurrence of an event, for as long as the page lives. */
  on(method: string, handler: (params: unknown) => void): void {
    const existing = this.listeners.get(method);
    if (existing === undefined) this.listeners.set(method, [handler]);
    else existing.push(handler);
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
