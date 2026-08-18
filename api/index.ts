/**
 * The public deployment: the React application, with one function behind it.
 *
 * Two things live at this origin. The static build in web/dist is the product
 * shell; everything under /api is this function. The JSON surface comes first,
 * and anything it does not claim falls through to the recorded snapshot site,
 * which is what the URL served before this build and stays reachable so no
 * existing link breaks.
 *
 * What this deployment honestly is: there is no HydraDB reachable from a
 * Vercel function and no writable filesystem for the account store, so the
 * application says so rather than pretending. Sessions report the store as
 * unavailable, health reports the node as unconfigured, and the workspace
 * reads answer with the recorded corpus's own inventory. Every one of those is
 * a state the product already knows how to draw.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiRouter } from '../src/api/router.js';
import { AccountStore } from '../src/auth/store.js';
import { buildDemo } from '../src/server/examples.js';
import { createSnapshotHandler } from '../src/snapshot/serve.js';

const snapshot = createSnapshotHandler(process.cwd());

// A read-only filesystem makes this store report unavailable, which is exactly
// what it should do here: the endpoints answer 503 and the screens say the
// account store is not configured rather than failing in an unexplained way.
const store = new AccountStore(process.env['LACUNA_ACCOUNTS_DIR'] ?? '/tmp/lacuna-store');

const api = new ApiRouter({
  store,
  secure: true,
  // No node is reachable from here, so the doctor is not run: reporting checks
  // that were never attempted would be worse than reporting none.
  health: null,
  inventory: buildDemo().inventory,
});

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://lacuna.invalid').pathname;
  if (path.startsWith('/api/')) {
    void api.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) snapshot(request, response);
    });
    return;
  }
  snapshot(request, response);
}
