/**
 * What the database was, when the evidence in `artifacts/hydradb` was taken.
 *
 * The file is `key=value` lines written by the capture script. It is parsed
 * rather than retyped into a page because a version number copied by hand is a
 * version number that goes stale silently, and the whole point of the page it
 * feeds is that a reader does not have to take the version on trust.
 *
 * One field is deliberately allowed to be empty. `neo4j_driver` records the
 * Python driver used for the Bolt read, and the capture ran without it on the
 * machine that produced the committed file. An empty value is reported as
 * absent, not as a version of nothing.
 */

export class ProvenanceError extends Error {
  override readonly name = 'ProvenanceError';
}

export interface Provenance {
  /** The exact commit of HydraDB that was built and run. */
  readonly commit: string;
  /** What `git describe` called it, which is the tag when there is one. */
  readonly describe: string;
  /** When the capture ran, in the ISO form the script wrote. */
  readonly capturedAt: string;
  readonly rustc: string;
  readonly uname: string;
  /** Absent when the capture ran without the Python driver installed. */
  readonly neo4jDriver: string | null;
}

const REQUIRED = ['hydradb_commit', 'hydradb_describe', 'captured_at', 'rustc', 'uname'] as const;

/**
 * Splits on the first `=` only.
 *
 * `uname` contains no `=` today, but a kernel string is not a field this file
 * controls, and splitting on every `=` would quietly truncate it the day one
 * appears. A blank line and a `#` comment are skipped so the capture script can
 * grow either without breaking the reader.
 */
function entries(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 1) throw new ProvenanceError(`provenance line is not key=value: ${trimmed}`);
    found.set(trimmed.slice(0, at), trimmed.slice(at + 1).trim());
  }
  return found;
}

export function parseProvenance(source: string): Provenance {
  const found = entries(source);
  for (const key of REQUIRED) {
    const value = found.get(key);
    if (value === undefined) throw new ProvenanceError(`provenance is missing ${key}`);
    if (value === '') throw new ProvenanceError(`provenance has an empty ${key}`);
  }

  const commit = found.get('hydradb_commit')!;
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new ProvenanceError(`hydradb_commit is not a full hash: ${commit}`);
  }

  const driver = found.get('neo4j_driver') ?? '';
  return {
    commit,
    describe: found.get('hydradb_describe')!,
    capturedAt: found.get('captured_at')!,
    rustc: found.get('rustc')!,
    uname: found.get('uname')!,
    neo4jDriver: driver === '' ? null : driver,
  };
}

/** The first twelve characters, which is what a commit is cited by in prose. */
export function shortCommit(provenance: Provenance): string {
  return provenance.commit.slice(0, 12);
}

/**
 * One line of a wire response, kept as text rather than as a parsed object.
 *
 * The smoke files are HydraDB's own output. Parsing them into a shape and
 * printing the shape would put this repository's rendering of the response on
 * the page instead of the response, which is the opposite of what an evidence
 * page is for. They are shown exactly as the node wrote them, and the only
 * processing is a length check so a page cannot be filled by a file that grew.
 */
export const MAX_EVIDENCE_CHARS = 4_096;

export function evidence(source: string): string {
  const trimmed = source.trim();
  if (trimmed.length > MAX_EVIDENCE_CHARS) {
    return `${trimmed.slice(0, MAX_EVIDENCE_CHARS)}\n[truncated at ${MAX_EVIDENCE_CHARS} characters]`;
  }
  return trimmed;
}
