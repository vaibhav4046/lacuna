/**
 * The public deployment: one function, every route.
 *
 * The rewrite in vercel.json sends each path here with its original URL
 * intact, and the handler routes exactly as it does locally. Answers come
 * from the recorded snapshot in artifacts/snapshot/, included in the bundle
 * by vercel.json, and every page that shows an answer says it is a replay.
 * There is no token in this environment because there is nothing to call.
 *
 * The working directory is passed as the artifact root: the bundler moves
 * this file, but includeFiles keeps artifacts/ at the function root.
 */

import { createSnapshotHandler } from '../src/snapshot/serve.js';

export default createSnapshotHandler(process.cwd());
