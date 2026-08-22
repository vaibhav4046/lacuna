import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GitLabImporter, type GitLabTransport, type GitLabTransportRequest, type GitLabTransportResponse } from '../../src/connectors/gitlab.js';
import { canonicalizeGitLabProjectRoot, isCanonicalGitLabProjectRoot } from '../../src/connectors/gitlab-project.js';
import { prepareConnectorDocument } from '../../src/connectors/normalize.js';

const PROJECT = 'https://gitlab.com/acme/project';
const COMMIT = 'a'.repeat(40);
const README = new TextEncoder().encode('# Lacuna\nEvidence first.\n');
const BLOB = createHash('sha1').update(`blob ${README.byteLength}\0`, 'utf8').update(README).digest('hex');

function json(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }

class FixtureTransport implements GitLabTransport {
  readonly requests: string[] = [];
  async request(request: GitLabTransportRequest): Promise<GitLabTransportResponse> {
    this.requests.push(request.url);
    const body = request.url.endsWith('/projects/acme%2Fproject')
      ? json({ id: 42, visibility: 'public', path_with_namespace: 'acme/project', default_branch: 'main' })
      : request.url.includes('/repository/commits?')
        ? json([{ id: COMMIT }])
        : request.url.includes('/repository/tree?')
          ? json([{ path: 'README.md', type: 'blob', id: BLOB }, { path: '.env', type: 'blob', id: 'b'.repeat(40) }])
          : README;
    return { status: 200, url: request.url, redirected: false, body };
  }
}

describe('GitLab project identity', () => {
  it('canonicalizes nested public project roots and rejects aliases', () => {
    expect(canonicalizeGitLabProjectRoot('https://gitlab.com/Acme/Platform/Memory')).toEqual({
      namespace: 'acme/platform/memory', projectUrl: 'https://gitlab.com/acme/platform/memory',
    });
    expect(isCanonicalGitLabProjectRoot('https://gitlab.com/acme/platform/memory')).toBe(true);
    for (const value of [
      'https://gitlab.com/acme/project/',
      'https://gitlab.com/acme/project.git',
      'https://gitlab.com/acme/project?token=secret',
      'http://gitlab.com/acme/project',
      'https://evil.example/acme/project',
    ]) expect(canonicalizeGitLabProjectRoot(value), value).toBeNull();
  });
});

describe('bounded GitLab importer', () => {
  it('imports an immutable public commit and preserves GitLab provenance', async () => {
    const transport = new FixtureTransport();
    const result = await new GitLabImporter({ transport, now: () => Date.UTC(2026, 7, 22, 12) })
      .importPublicProject(PROJECT, new AbortController().signal);
    expect(result.projectUrl).toBe(PROJECT);
    expect(result.commitSha).toBe(COMMIT);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.provenance).toMatchObject({
      connectorId: 'gitlab', sourceUrl: `${PROJECT}/-/blob/${COMMIT}/README.md`,
      gitlab: { projectUrl: PROJECT, commitSha: COMMIT, path: 'README.md', blobSha: BLOB, parserVersion: 'gitlab-v1' },
    });
    expect(result.skipped).toContainEqual({ reason: 'secret_filename', count: 1 });
    expect(transport.requests).toHaveLength(4);
  });

  it('rejects a blob whose content does not match the tree sha', async () => {
    class CorruptTransport extends FixtureTransport {
      override async request(request: GitLabTransportRequest): Promise<GitLabTransportResponse> {
        const result = await super.request(request);
        if (request.url.includes('/repository/files/')) return { ...result, body: new TextEncoder().encode('tampered') };
        return result;
      }
    }
    await expect(new GitLabImporter({ transport: new CorruptTransport() })
      .importPublicProject(PROJECT, new AbortController().signal))
      .rejects.toMatchObject({ code: 'gitlab_integrity_failed', status: 502 });
  });

  it('accepts the normalized provenance as a durable connector document', async () => {
    const observedAt = new Date(Date.UTC(2026, 7, 22, 12)).toISOString();
    expect(() => prepareConnectorDocument({
      title: 'README.md', text: README,
      provenance: {
        connectorId: 'gitlab', sourceUrl: `${PROJECT}/-/blob/${COMMIT}/README.md`, mediaType: 'text/markdown', observedAt,
        gitlab: { projectUrl: PROJECT, commitSha: COMMIT, path: 'README.md', blobSha: BLOB, retrievedAt: observedAt, rawDigest: createHash('sha256').update(README).digest('hex'), parserVersion: 'gitlab-v1' },
      },
    })).not.toThrow();
  });
});
