/**
 * The one module that reads the artifact files from disk.
 *
 * Everything else in `src/report` is a pure function over a string, and
 * everything in `src/view` is a pure function over the parsed result. Keeping
 * the file system in exactly one place is what lets the parsers and the pages
 * be tested without a fixture directory, and it is the same shape the rest of
 * the server already has: `scripts/serve.ts` gathers, `createHandler` renders.
 *
 * Reads happen once at start up. The artifacts are committed files that cannot
 * change while the process runs, so re-reading them per request would buy
 * nothing and would put a synchronous disk read on the request path.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type BenchReport, parseBenchReport } from './bench.js';
import { evidence, parseProvenance, type Provenance } from './provenance.js';

/**
 * Resolved against this file, so the process's working directory is
 * irrelevant — unless a root is given, for callers whose files have been
 * moved by a bundler and whose `import.meta.url` no longer points at the
 * repository layout.
 */
function artifact(relative: string, root: string | undefined): URL | string {
  if (root !== undefined) return join(root, 'artifacts', relative);
  return new URL(`../../artifacts/${relative}`, import.meta.url);
}

function text(relative: string, root: string | undefined): string {
  try {
    return readFileSync(artifact(relative, root), 'utf8');
  } catch (error) {
    throw new Error(`could not read artifacts/${relative}: ${(error as Error).message}`);
  }
}

/**
 * The captured evidence that HydraDB ran, as the node printed it.
 *
 * Each field is one committed file. The names say what produced them rather
 * than what they show, because a reader checking the page against the
 * repository needs to find the file, not agree with the summary.
 */
export interface HydraEvidence {
  readonly provenance: Provenance;
  /** `POST /query` writing a vertex, over the HTTP interface. */
  readonly smokeWrite: string;
  /** `POST /query` reading it back, with the read epoch the node reported. */
  readonly smokeRead: string;
  /** The same read over the Bolt interface, through the Python driver. */
  readonly boltRead: string;
  /** `graph_runtime_ready` from the admin port's Prometheus endpoint. */
  readonly metricsReady: string;
  /** The runtime smoke target from the repository's own justfile. */
  readonly runtimeSmoke: string;
  /** The object store smoke target, which reports the epoch it reached. */
  readonly storeSmoke: string;
}

export interface Artifacts {
  readonly bench: BenchReport;
  readonly hydra: HydraEvidence;
}

/** `root` is the directory holding `artifacts/`; omitted, paths resolve against this file. */
export function loadArtifacts(root?: string): Artifacts {
  return {
    bench: parseBenchReport(text('bench/results.json', root)),
    hydra: {
      provenance: parseProvenance(text('hydradb/provenance.txt', root)),
      smokeWrite: evidence(text('hydradb/smoke-write.json', root)),
      smokeRead: evidence(text('hydradb/smoke-read.json', root)),
      boltRead: evidence(text('hydradb/bolt-read.txt', root)),
      metricsReady: evidence(text('hydradb/metrics-ready.txt', root)),
      runtimeSmoke: evidence(text('hydradb/runtime-smoke-result.txt', root)),
      storeSmoke: evidence(text('hydradb/just-smoke-result.txt', root)),
    },
  };
}
