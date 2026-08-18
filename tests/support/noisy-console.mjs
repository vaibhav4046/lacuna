/**
 * An accident, on purpose.
 *
 * Node loads this with `--import` before the MCP entry point, and from then on
 * it writes a line through `console.log` every twenty five milliseconds for as
 * long as the process lives. That is the mistake the stdio transport has to
 * survive: a dependency printing a notice, a debug line left in during a
 * change, anything at all reaching the console while JSON-RPC frames are
 * travelling on the same descriptor.
 *
 * The writes go through the timer queue rather than at import time, which is
 * what makes them a fair test. A timer callback resolves `console.log` when it
 * fires, so it picks up whatever the entry point rebound it to, exactly as a
 * log line inside a tool handler would. Logging here at import time would only
 * prove that a preload runs before the module it precedes.
 *
 * The interval is unreferenced so it never keeps the process alive on its own.
 */

const NOISE = 'noisy-console: this line must not reach stdout';

const timer = setInterval(() => {
  console.log(NOISE);
  console.info(NOISE);
  console.warn(NOISE);
  console.error(NOISE);
  console.debug(NOISE);
}, 25);

timer.unref();

setImmediate(() => { console.log(`${NOISE} (immediate)`); });
