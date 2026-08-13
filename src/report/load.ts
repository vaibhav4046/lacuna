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

import { type BenchReport, parseBenchReport } from './bench';
import { evidence, parseProvenance, type Provenance } from './provenance';

/** Resolved against this file, so the process's working directory is irrelevant. */
function artifact(relative: string): URL {
  return new URL(`../../artifacts/${relative}`, import.meta.url);
}

function text(relative: string): string {
  try {
    return readFileSync(artifact(relative), 'utf8');
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

export function loadArtifacts(): Artifacts {
  return {
    bench: parseBenchReport(text('bench/results.json')),
    hydra: {
      provenance: parseProvenance(text('hydradb/provenance.txt')),
      smokeWrite: evidence(text('hydradb/smoke-write.json')),
      smokeRead: evidence(text('hydradb/smoke-read.json')),
      boltRead: evidence(text('hydradb/bolt-read.txt')),
      metricsReady: evidence(text('hydradb/metrics-ready.txt')),
      runtimeSmoke: evidence(text('hydradb/runtime-smoke-result.txt')),
      storeSmoke: evidence(text('hydradb/just-smoke-result.txt')),
    },
  };
}
