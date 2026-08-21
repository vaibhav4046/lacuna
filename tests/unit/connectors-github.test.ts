import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GitHubImporter,
  GitHubImportError,
  type GitHubTransport,
  type GitHubTransportRequest,
  type GitHubTransportResponse,
} from '../../src/connectors/github.js';
import { prepareConnectorDocument } from '../../src/connectors/normalize.js';

const COMMIT_SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const RETRIEVED_AT = '2026-08-21T12:00:00.000Z';
const API_ROOT = 'https://api.github.com/repos/acme/atlas';

function json(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly size?: number;
}

class FixtureTransport implements GitHubTransport {
  readonly requests: GitHubTransportRequest[] = [];
  readonly responses = new Map<string, GitHubTransportResponse | ((request: GitHubTransportRequest) => Promise<GitHubTransportResponse>)>();

  setJson(url: string, value: unknown, overrides: Partial<Omit<GitHubTransportResponse, 'body'>> = {}): void {
    this.responses.set(url, {
      status: 200,
      url,
      redirected: false,
      ...overrides,
      body: json(value),
    });
  }

  async request(request: GitHubTransportRequest): Promise<GitHubTransportResponse> {
    this.requests.push(request);
    const response = this.responses.get(request.url);
    if (response === undefined) throw new Error(`unconfigured test URL: ${request.url}`);
    return typeof response === 'function' ? await response(request) : response;
  }
}

function fixture(
  files: Readonly<Record<string, Uint8Array | string>> = {
    'README.md': '# Atlas\na: Atlas is owned by Priya.',
  },
  extraTree: readonly TreeEntry[] = [],
): { readonly transport: FixtureTransport; readonly entries: readonly TreeEntry[] } {
  const transport = new FixtureTransport();
  const entries: TreeEntry[] = [];
  transport.setJson(API_ROOT, {
    full_name: 'Acme/Atlas',
    private: false,
    default_branch: 'main',
  });
  transport.setJson(`${API_ROOT}/commits/main`, {
    sha: COMMIT_SHA,
    commit: { tree: { sha: TREE_SHA } },
  });
  for (const [path, value] of Object.entries(files)) {
    const bytes = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
    const sha = gitBlobSha(bytes);
    entries.push({ path, mode: '100644', type: 'blob', sha, size: bytes.length });
    transport.setJson(`${API_ROOT}/git/blobs/${sha}`, {
      sha,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
    });
  }
  entries.push(...extraTree);
  transport.setJson(`${API_ROOT}/git/trees/${TREE_SHA}?recursive=1`, {
    sha: TREE_SHA,
    truncated: false,
    tree: entries,
  });
  return { transport, entries };
}

function importer(transport: GitHubTransport, overrides: Record<string, unknown> = {}): GitHubImporter {
  return new GitHubImporter({
    transport,
    now: () => Date.parse(RETRIEVED_AT),
    ...overrides,
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'GitHubImportError', code });
}

describe('bounded public GitHub repository importer', () => {
  it('normalizes one .git suffix and reads one immutable commit/tree/blob sequence with fixed anonymous headers', async () => {
    const source = Buffer.from('# Atlas\na: Atlas is owned by Priya.', 'utf8');
    const { transport } = fixture({ 'README.md': source });
    const first = await importer(transport).importPublicRepo(
      'https://github.com/Acme/Atlas.git',
      new AbortController().signal,
    );

    const blobSha = gitBlobSha(source);
    expect(transport.requests.map((request) => request.url)).toEqual([
      API_ROOT,
      `${API_ROOT}/commits/main`,
      `${API_ROOT}/git/trees/${TREE_SHA}?recursive=1`,
      `${API_ROOT}/git/blobs/${blobSha}`,
    ]);
    for (const request of transport.requests) {
      expect(request).toMatchObject({
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'Lacuna-Connector/1.0',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      expect(Object.keys(request).sort()).toEqual(['headers', 'maxResponseBytes', 'method', 'signal', 'url']);
      expect(JSON.stringify(request.headers).toLowerCase()).not.toContain('authorization');
      expect(JSON.stringify(request.headers).toLowerCase()).not.toContain('cookie');
    }
    expect(first).toMatchObject({
      repositoryUrl: 'https://github.com/acme/atlas',
      commitSha: COMMIT_SHA,
      consideredEntries: 1,
      fetchedBlobs: 1,
      duplicates: 0,
      skipped: [],
      snapshotDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(first.documents).toHaveLength(1);
    expect(first.documents[0]).toMatchObject({
      title: 'README.md',
      text: source.toString('utf8'),
      provenance: {
        connectorId: 'github',
        sourceUrl: `https://github.com/acme/atlas/blob/${COMMIT_SHA}/README.md`,
        mediaType: 'text/markdown',
        observedAt: RETRIEVED_AT,
        github: {
          repositoryUrl: 'https://github.com/acme/atlas',
          commitSha: COMMIT_SHA,
          path: 'README.md',
          blobSha,
          retrievedAt: RETRIEVED_AT,
          rawDigest: sha256(source),
          parserVersion: 'github-v1',
        },
      },
    });

    const replayFixture = fixture({ 'README.md': source });
    const replay = await new GitHubImporter({
      transport: replayFixture.transport,
      now: () => Date.parse(RETRIEVED_AT) + 60_000,
    }).importPublicRepo('https://github.com/acme/atlas', new AbortController().signal);
    expect(replay.documents[0]?.sourceKey).toBe(first.documents[0]?.sourceKey);
    expect(replay.snapshotDigest).toBe(first.snapshotDigest);
    expect(replay.documents[0]?.provenance.observedAt).toBe('2026-08-21T12:01:00.000Z');
    const prepared = first.documents[0];
    if (prepared === undefined) throw new Error('expected prepared GitHub document');
    expect(() => prepareConnectorDocument({
      title: prepared.title,
      text: prepared.text,
      provenance: { ...prepared.provenance, sourceUrl: 'https://github.com/acme/other/blob/'.concat(COMMIT_SHA, '/README.md') },
    })).toThrow(/invalid_provenance/u);
  });

  it('normalizes a case-insensitive single .git suffix without accepting a repeated suffix', async () => {
    const { transport } = fixture();
    const result = await importer(transport).importPublicRepo(
      'https://github.com/ACME/ATLAS.GIT',
      new AbortController().signal,
    );
    expect(result.repositoryUrl).toBe('https://github.com/acme/atlas');

    const repeated = fixture();
    await expectCode(importer(repeated.transport).importPublicRepo(
      'https://github.com/acme/atlas.GIT.GIT',
      new AbortController().signal,
    ), 'invalid_repository_url');
    expect(repeated.transport.requests).toEqual([]);
  });

  it.each([
    'http://github.com/acme/atlas',
    'https://gitlab.com/acme/atlas',
    'https://github.com.evil.test/acme/atlas',
    'https://github.com@evil.test/acme/atlas',
    'https://user:pass@github.com/acme/atlas',
    'https://github.com:443/acme/atlas',
    'https://github.com/acme/atlas?token=secret',
    'https://github.com/acme/atlas#readme',
    'https://github.com/acme/atlas/',
    'https://github.com/acme/atlas/tree/main/src',
    'https://github.com/acme/atlas.git.git',
    'https://github.com/-acme/atlas',
    'https://github.com/acme/repo name',
    'https://github.enterprise.test/acme/atlas',
    'https://gıthub.com/acme/atlas',
    'https://github.com/%61cme/atlas',
  ])('rejects noncanonical repository URL %s before transport', async (url) => {
    const { transport } = fixture();
    await expectCode(
      importer(transport).importPublicRepo(url, new AbortController().signal),
      'invalid_repository_url',
    );
    expect(transport.requests).toEqual([]);
  });

  it.each([
    ['redirect', (transport: FixtureTransport) => transport.setJson(API_ROOT, {}, {
      status: 301, redirected: true, url: 'https://objects.example.test/private',
    }), 'github_unavailable'],
    ['provider refusal', (transport: FixtureTransport) => transport.setJson(API_ROOT, { secret: 'private' }, {
      status: 404,
    }), 'github_unavailable'],
    ['rate limit', (transport: FixtureTransport) => transport.setJson(API_ROOT, { reset: 'provider detail' }, {
      status: 403,
    }), 'github_unavailable'],
    ['provider error', (transport: FixtureTransport) => transport.setJson(API_ROOT, { trace: 'provider detail' }, {
      status: 500,
    }), 'github_unavailable'],
    ['invalid commit SHA', (transport: FixtureTransport) => transport.setJson(`${API_ROOT}/commits/main`, {
      sha: 'not-a-sha', commit: { tree: { sha: TREE_SHA } },
    }), 'github_snapshot_invalid'],
    ['invalid tree SHA', (transport: FixtureTransport) => transport.setJson(`${API_ROOT}/commits/main`, {
      sha: COMMIT_SHA, commit: { tree: { sha: 'c'.repeat(39) } },
    }), 'github_snapshot_invalid'],
    ['truncated tree', (transport: FixtureTransport) => transport.setJson(
      `${API_ROOT}/git/trees/${TREE_SHA}?recursive=1`,
      { sha: TREE_SHA, truncated: true, tree: [] },
    ), 'github_snapshot_invalid'],
  ] as const)('fails closed on %s without provider diagnostics', async (_label, mutate, code) => {
    const { transport } = fixture();
    mutate(transport);
    const error = importer(transport).importPublicRepo(
      'https://github.com/acme/atlas',
      new AbortController().signal,
    );
    await expectCode(error, code);
    await expect(error).rejects.not.toThrow(/secret|objects\.example|not-a-sha/u);
  });

  it('bounds and validates the default branch before encoding it into the fixed commits endpoint', async () => {
    const { transport } = fixture();
    transport.setJson(API_ROOT, {
      full_name: 'Acme/Atlas', private: false, default_branch: 'main?token=provider-secret',
    });
    await expectCode(importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_snapshot_invalid');
    expect(transport.requests.map((request) => request.url)).toEqual([API_ROOT]);
  });

  it('enforces one total deadline and aborts the in-flight request', async () => {
    const transport = new FixtureTransport();
    let observedAbort = false;
    transport.responses.set(API_ROOT, async (request) => await new Promise<GitHubTransportResponse>((_resolve, reject) => {
      request.signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(new DOMException('provider detail', 'AbortError'));
      }, { once: true });
    }));

    await expectCode(importer(transport, { deadlineMs: 15 }).importPublicRepo(
      'https://github.com/acme/atlas',
      new AbortController().signal,
    ), 'github_timeout');
    expect(observedAbort).toBe(true);
  });

  it('enforces request, response, tree, file, and aggregate budgets deterministically', async () => {
    const requestFixture = fixture();
    await expectCode(importer(requestFixture.transport, { maxRequests: 2 }).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_budget_exceeded');
    expect(requestFixture.transport.requests).toHaveLength(2);

    const responseFixture = fixture();
    responseFixture.transport.responses.set(API_ROOT, async (request) => ({
      status: 200, url: request.url, redirected: false, body: new Uint8Array(request.maxResponseBytes + 1),
    }));
    await expectCode(importer(responseFixture.transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_budget_exceeded');

    const treeFixture = fixture({
      'a.md': 'a: one', 'b.md': 'b: two', 'c.md': 'c: three',
    });
    await expectCode(importer(treeFixture.transport, { maxTreeEntries: 2 }).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_budget_exceeded');

    const fileFixture = fixture({ 'z.md': 'z: three', 'a.md': 'a: one', 'm.md': 'm: two' });
    const fileLimited = await importer(fileFixture.transport, { maxFiles: 2 }).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );
    expect(fileLimited.documents.map((document) => document.title)).toEqual(['a.md', 'm.md']);
    expect(fileLimited.skipped).toContainEqual({ reason: 'file_limit', count: 1 });
    expect(fileFixture.transport.requests.filter((request) => request.url.includes('/git/blobs/'))).toHaveLength(2);

    const aggregateFixture = fixture({ 'a.md': '1234567890', 'b.md': 'abcdefghij' });
    await expectCode(importer(aggregateFixture.transport, { maxAggregateBytes: 15 }).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_budget_exceeded');

    const perFileFixture = fixture({ 'a-large.md': '12345678901', 'z-valid.md': 'a: valid' });
    const perFile = await importer(perFileFixture.transport, { maxFileBytes: 10 }).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );
    expect(perFile.documents.map((document) => document.title)).toEqual(['z-valid.md']);
    expect(perFile.skipped).toContainEqual({ reason: 'file_too_large', count: 1 });
  });

  it.each([
    ['duplicate path', [
      { path: 'README.md', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1 },
    ]],
    ['case-fold collision', [
      { path: 'readme.MD', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1 },
    ]],
    ['traversal', [
      { path: '../secret.md', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1 },
    ]],
    ['backslash', [
      { path: 'src\\secret.md', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 1 },
    ]],
  ] as const)('rejects structurally unsafe tree paths: %s', async (_label, extraTree) => {
    const { transport } = fixture({ 'README.md': 'a: Atlas is owned by Priya.' }, extraTree);
    await expectCode(importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_snapshot_invalid');
    expect(transport.requests.some((request) => request.url.includes('/git/blobs/'))).toBe(false);
  });

  it('rejects Unicode paths before Straße and STRASSE can become ambiguous while accepting the ASCII path', async () => {
    const ascii = Buffer.from('a: Atlas is owned by Priya.', 'utf8');
    const asciiSha = gitBlobSha(ascii);
    const mixed = fixture({}, [
      { path: 'docs/Straße.md', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 4 },
      { path: 'docs/STRASSE.md', mode: '100644', type: 'blob', sha: asciiSha, size: ascii.length },
    ]);
    await expectCode(importer(mixed.transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), 'github_snapshot_invalid');
    expect(mixed.transport.requests.some((request) => request.url.includes('/git/blobs/'))).toBe(false);

    const canonical = fixture({ 'docs/STRASSE.md': ascii });
    const accepted = await importer(canonical.transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );
    expect(accepted.documents.map((document) => document.title)).toEqual(['docs/STRASSE.md']);

    const prepared = accepted.documents[0];
    if (prepared === undefined || prepared.provenance.github === undefined) {
      throw new Error('missing canonical GitHub provenance');
    }
    const github = prepared.provenance.github;
    expect(() => prepareConnectorDocument({
      title: 'docs/Straße.md',
      text: prepared.text,
      provenance: {
        ...prepared.provenance,
        sourceUrl: `https://github.com/acme/atlas/blob/${COMMIT_SHA}/docs/Stra%C3%9Fe.md`,
        github: { ...github, path: 'docs/Straße.md' },
      },
    })).toThrow(/invalid_provenance/u);
  });

  it('filters unsafe kinds, directories, names, locks, executables, and unsupported files into stable counts', async () => {
    const safe = Buffer.from('a: Atlas is owned by Priya.', 'utf8');
    const extra: TreeEntry[] = [
      { path: 'link.md', mode: '120000', type: 'blob', sha: '1'.repeat(40), size: 4 },
      { path: 'module', mode: '160000', type: 'commit', sha: '2'.repeat(40) },
      { path: 'run.ts', mode: '100755', type: 'blob', sha: '3'.repeat(40), size: 4 },
      { path: 'vendor/lib.ts', mode: '100644', type: 'blob', sha: '4'.repeat(40), size: 4 },
      { path: 'dist/out.js', mode: '100644', type: 'blob', sha: '5'.repeat(40), size: 4 },
      { path: '.env.production', mode: '100644', type: 'blob', sha: '6'.repeat(40), size: 4 },
      { path: 'credentials.json', mode: '100644', type: 'blob', sha: '7'.repeat(40), size: 4 },
      { path: '.docker/config.json', mode: '100644', type: 'blob', sha: 'a'.repeat(40), size: 4 },
      { path: '.netrc', mode: '100644', type: 'blob', sha: 'b'.repeat(40), size: 4 },
      { path: 'api_key.json', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 4 },
      { path: '.venv/lib/python.py', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 4 },
      { path: 'venv/lib/python.py', mode: '100644', type: 'blob', sha: 'e'.repeat(40), size: 4 },
      { path: 'env/settings.py', mode: '100644', type: 'blob', sha: 'f'.repeat(40), size: 4 },
      { path: 'site-packages/pkg.py', mode: '100644', type: 'blob', sha: '1'.repeat(40), size: 4 },
      { path: 'third_party/lib.ts', mode: '100644', type: 'blob', sha: '2'.repeat(40), size: 4 },
      { path: 'third-party/lib.ts', mode: '100644', type: 'blob', sha: '3'.repeat(40), size: 4 },
      { path: 'deps/lib.ts', mode: '100644', type: 'blob', sha: '4'.repeat(40), size: 4 },
      { path: 'dependencies/lib.ts', mode: '100644', type: 'blob', sha: '5'.repeat(40), size: 4 },
      { path: '.bundle/vendor.rb', mode: '100644', type: 'blob', sha: '6'.repeat(40), size: 4 },
      { path: 'node_modules/pkg.js', mode: '100644', type: 'blob', sha: '7'.repeat(40), size: 4 },
      { path: 'bower_components/pkg.js', mode: '100644', type: 'blob', sha: '8'.repeat(40), size: 4 },
      { path: 'auth.json', mode: '100644', type: 'blob', sha: '9'.repeat(40), size: 4 },
      { path: 'service-account.json', mode: '100644', type: 'blob', sha: 'a'.repeat(40), size: 4 },
      { path: 'service_account.json', mode: '100644', type: 'blob', sha: 'b'.repeat(40), size: 4 },
      { path: 'secrets.json', mode: '100644', type: 'blob', sha: 'c'.repeat(40), size: 4 },
      { path: 'application_default_credentials.json', mode: '100644', type: 'blob', sha: 'd'.repeat(40), size: 4 },
      { path: '.npmrc', mode: '100644', type: 'blob', sha: 'e'.repeat(40), size: 4 },
      { path: '.pypirc', mode: '100644', type: 'blob', sha: 'f'.repeat(40), size: 4 },
      { path: 'pip.conf', mode: '100644', type: 'blob', sha: '1'.repeat(40), size: 4 },
      { path: 'id_rsa', mode: '100644', type: 'blob', sha: '2'.repeat(40), size: 4 },
      { path: 'id_ed25519', mode: '100644', type: 'blob', sha: '3'.repeat(40), size: 4 },
      { path: '.aws/credentials', mode: '100644', type: 'blob', sha: '4'.repeat(40), size: 4 },
      { path: '.aws/config', mode: '100644', type: 'blob', sha: '5'.repeat(40), size: 4 },
      { path: 'package-lock.json', mode: '100644', type: 'blob', sha: '8'.repeat(40), size: 4 },
      { path: 'logo.png', mode: '100644', type: 'blob', sha: '9'.repeat(40), size: 4 },
    ];
    const { transport } = fixture({
      'README.md': safe,
      'config.json': '{"theme":"dark"}',
    }, extra);

    const result = await importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );

    expect(result.documents.map((document) => document.title)).toEqual(['README.md', 'config.json']);
    expect(result.skipped).toEqual([
      { reason: 'excluded_directory', count: 13 },
      { reason: 'executable', count: 1 },
      { reason: 'lockfile', count: 1 },
      { reason: 'secret_filename', count: 17 },
      { reason: 'submodule', count: 1 },
      { reason: 'symlink', count: 1 },
      { reason: 'unsupported_extension', count: 1 },
    ]);
  });

  it('skips LFS, invalid UTF-8, NUL/binary, and oversized text but never stores empty documents', async () => {
    const files = {
      '0-empty.txt': Buffer.alloc(0),
      'a-lfs.md': 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 10',
      'a2-lfs-bom.md': '\ufeffversion https://git-lfs.github.com/spec/v1\noid sha256:def\nsize 11',
      'b-invalid.txt': Buffer.from([0xc3, 0x28]),
      'c-nul.txt': Buffer.from('a\0b', 'binary'),
      'd-binary.txt': Buffer.from([0x01, 0x02, 0x03]),
      'e-long.md': 'x'.repeat(20_001),
      'z-valid.md': 'a: Atlas is owned by Priya.',
    };
    const { transport } = fixture(files);
    const result = await importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.title).toBe('z-valid.md');
    expect(result.skipped).toEqual([
      { reason: 'binary', count: 2 },
      { reason: 'document_too_long', count: 1 },
      { reason: 'empty', count: 1 },
      { reason: 'git_lfs', count: 2 },
      { reason: 'invalid_utf8', count: 1 },
    ]);
    expect(result.documents.every((document) => document.text.length > 0)).toBe(true);
  });

  it.each([
    ['invalid base64', { encoding: 'base64', content: '!!!!' }, 'github_snapshot_invalid'],
    ['invalid response blob SHA', { sha: 'not-a-sha' }, 'github_snapshot_invalid'],
    ['response blob SHA mismatch', { sha: 'f'.repeat(40) }, 'github_integrity_failed'],
    ['decoded size mismatch', { size: 999 }, 'github_integrity_failed'],
    ['git object SHA mismatch', { content: Buffer.from('different').toString('base64'), size: 9 }, 'github_integrity_failed'],
  ] as const)('aborts the snapshot on %s', async (_label, override, code) => {
    const bytes = Buffer.from('a: Atlas is owned by Priya.', 'utf8');
    const blobSha = gitBlobSha(bytes);
    const { transport } = fixture({ 'README.md': bytes });
    transport.setJson(`${API_ROOT}/git/blobs/${blobSha}`, {
      sha: blobSha,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
      ...override,
    });
    await expectCode(importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    ), code);
  });

  it('rejects a repository with no acceptable documents using one stable validation code', async () => {
    const { transport } = fixture({}, [
      { path: 'logo.png', mode: '100644', type: 'blob', sha: '9'.repeat(40), size: 4 },
    ]);
    const promise = importer(transport).importPublicRepo(
      'https://github.com/acme/atlas', new AbortController().signal,
    );
    await expectCode(promise, 'github_no_documents');
    await expect(promise).rejects.toBeInstanceOf(GitHubImportError);
  });
});
