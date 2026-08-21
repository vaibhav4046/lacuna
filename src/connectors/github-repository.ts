const GITHUB_WEB_PREFIX = 'https://github.com/';
const OWNER = /^(?!-)(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}$/u;

export interface CanonicalGitHubRepositoryRoot {
  readonly owner: string;
  readonly repository: string;
  readonly repositoryUrl: string;
}

/**
 * Accepts the one public-import alias the product supports (one `.git`
 * suffix), then returns the exact lowercase repository root used in identity
 * and persistence. No API response or stored record is allowed to bypass this
 * grammar.
 */
export function canonicalizeGitHubRepositoryRoot(
  value: unknown,
): CanonicalGitHubRepositoryRoot | null {
  if (typeof value !== 'string' || value.length > 2_048 || !value.startsWith(GITHUB_WEB_PREFIX)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.port !== ''
    || parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') {
    return null;
  }
  const segments = value.slice(GITHUB_WEB_PREFIX.length).split('/');
  if (segments.length !== 2) return null;
  const owner = segments[0] ?? '';
  const suppliedRepository = segments[1] ?? '';
  const repository = suppliedRepository.toLowerCase().endsWith('.git')
    ? suppliedRepository.slice(0, -4)
    : suppliedRepository;
  if (!OWNER.test(owner) || !REPOSITORY.test(repository)
    || repository === '.' || repository === '..' || repository.toLowerCase().endsWith('.git')) {
    return null;
  }
  const canonicalOwner = owner.toLowerCase();
  const canonicalRepository = repository.toLowerCase();
  return Object.freeze({
    owner: canonicalOwner,
    repository: canonicalRepository,
    repositoryUrl: `${GITHUB_WEB_PREFIX}${canonicalOwner}/${canonicalRepository}`,
  });
}

/** True only for the canonical root persisted in connector evidence. */
export function isCanonicalGitHubRepositoryRoot(value: unknown): value is string {
  const canonical = canonicalizeGitHubRepositoryRoot(value);
  return canonical !== null && canonical.repositoryUrl === value;
}
