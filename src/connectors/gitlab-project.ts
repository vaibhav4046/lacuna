const GITLAB_WEB_PREFIX = 'https://gitlab.com/';
const PATH_PART = /^(?!-)(?!.*--)[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/u;

export interface CanonicalGitLabProjectRoot {
  readonly namespace: string;
  readonly projectUrl: string;
}

/**
 * Accepts one public GitLab project root, including nested groups, and returns
 * the lowercase identity used by the importer and persisted provenance.
 * Credentials, query strings, fragments, archive aliases and `.git` suffixes
 * are deliberately outside this grammar.
 */
export function canonicalizeGitLabProjectRoot(value: unknown): CanonicalGitLabProjectRoot | null {
  if (typeof value !== 'string' || value.length > 2_048 || !value.startsWith(GITLAB_WEB_PREFIX)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'gitlab.com' || parsed.port !== ''
    || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return null;
  }
  const raw = value.slice(GITLAB_WEB_PREFIX.length);
  if (raw.endsWith('/') || raw.includes('//')) return null;
  const parts = raw.split('/');
  if (parts.length < 2 || parts.length > 20 || parts.some((part) => !PATH_PART.test(part))) return null;
  const namespace = parts.join('/').toLowerCase();
  if (namespace.endsWith('.git')) return null;
  return Object.freeze({ namespace, projectUrl: `${GITLAB_WEB_PREFIX}${namespace}` });
}

export function isCanonicalGitLabProjectRoot(value: unknown): value is string {
  const canonical = canonicalizeGitLabProjectRoot(value);
  return canonical !== null && canonical.projectUrl === value;
}
