import { describe, expect, it } from 'vitest';

import {
  ConnectorNormalizationError,
  MAX_CONNECTOR_DOCUMENTS,
  MAX_CONNECTOR_TEXT_BYTES,
  prepareConnectorBatch,
  prepareConnectorDocument,
} from '../../src/connectors/normalize.js';

const provenance = {
  connectorId: 'text' as const,
  sourceUrl: 'https://EXAMPLE.com:443/a?b=2&a=1#ignored',
  mediaType: 'text/plain' as const,
  observedAt: '2026-08-21T10:00:00.000Z',
};

describe('connector document normalization', () => {
  it('normalizes the canonical text, title, URL, and exact provenance vocabulary', () => {
    const prepared = prepareConnectorDocument({
      title: '  README\u0000  ',
      text: '\ufeffA\r\nB\r\u0000',
      provenance,
    });

    expect(prepared).toMatchObject({
      title: 'README',
      text: 'A\nB\n',
      contentDigest: 'daee1cd25194ae952d046ad9b9c81d3c07dc5332440b58d6d7461b248be56712',
      provenance: {
        connectorId: 'text',
        sourceUrl: 'https://example.com/a?a=1&b=2',
        mediaType: 'text/plain',
        observedAt: '2026-08-21T10:00:00.000Z',
      },
    });
    expect(prepared.sourceKey).toMatch(/^src-[0-9a-f]{64}$/u);
    expect(Object.keys(prepared.provenance).sort()).toEqual([
      'connectorId', 'mediaType', 'observedAt', 'sourceUrl',
    ]);
  });

  it('uses fatal UTF-8 decoding at the byte boundary', () => {
    const invalid = new Uint8Array([0xc3, 0x28]);

    expect(() => prepareConnectorDocument({ title: 'bad', text: invalid, provenance }))
      .toThrowError(new ConnectorNormalizationError('invalid_utf8'));
  });

  it('rejects malformed, non-HTTPS, credentialed, and foreign provenance fields', () => {
    for (const sourceUrl of ['not a url', 'http://example.com/a', 'https://user@example.com/a']) {
      expect(() => prepareConnectorDocument({ title: 'bad', text: 'text', provenance: { ...provenance, sourceUrl } }))
        .toThrowError(new ConnectorNormalizationError('invalid_provenance'));
    }
    expect(() => prepareConnectorDocument({
      title: 'bad',
      text: 'text',
      provenance: { ...provenance, providerBody: 'secret response' } as never,
    })).toThrowError(new ConnectorNormalizationError('invalid_provenance'));
  });

  it('is deterministic and excludes observation time from convergent content/source identity', () => {
    const first = prepareConnectorDocument({ title: ' README ', text: 'same', provenance });
    const repeated = prepareConnectorDocument({ title: 'README', text: new TextEncoder().encode('same'), provenance });
    const observedLater = prepareConnectorDocument({
      title: 'README',
      text: 'same',
      provenance: { ...provenance, observedAt: '2026-08-21T11:00:00.000Z' },
    });

    expect(repeated).toEqual(first);
    expect(observedLater.sourceKey).toBe(first.sourceKey);
    expect(observedLater.contentDigest).toBe(first.contentDigest);
    expect(observedLater.provenanceKey).toBe(first.provenanceKey);
  });

  it.each([
    `https://github.com/${'a'.repeat(40)}/atlas`,
    'https://github.com/acme--labs/atlas',
    `https://github.com/acme/${'a'.repeat(101)}`,
    'https://github.com/acme/atlas.git',
  ])('rejects a noncanonical persisted GitHub repository root: %s', (repositoryUrl) => {
    const commitSha = 'a'.repeat(40);
    expect(() => prepareConnectorDocument({
      title: 'README.md',
      text: 'a: Atlas is owned by Priya.',
      provenance: {
        connectorId: 'github',
        sourceUrl: `${repositoryUrl}/blob/${commitSha}/README.md`,
        mediaType: 'text/markdown',
        observedAt: '2026-08-21T10:00:00.000Z',
        github: {
          repositoryUrl,
          commitSha,
          path: 'README.md',
          blobSha: 'b'.repeat(40),
          retrievedAt: '2026-08-21T10:00:00.000Z',
          rawDigest: 'c'.repeat(64),
          parserVersion: 'github-v1',
        },
      },
    })).toThrowError(new ConnectorNormalizationError('invalid_provenance'));
  });
});

describe('connector batch normalization', () => {
  it('deduplicates identical content plus canonical provenance before any write', () => {
    const batch = prepareConnectorBatch([
      { title: 'A', text: 'same', provenance },
      { title: 'A', text: new TextEncoder().encode('same'), provenance: { ...provenance, sourceUrl: 'https://example.com:443/a?a=1&b=2' } },
    ]);

    expect(batch.documents).toHaveLength(1);
    expect(batch.duplicates).toBe(1);
    expect(batch.normalizedTextBytes).toBe(4);
  });

  it('accepts at most thirty input documents', () => {
    const documents = Array.from({ length: MAX_CONNECTOR_DOCUMENTS + 1 }, (_, index) => ({
      title: `Doc ${index}`,
      text: 'x',
      provenance: { ...provenance, sourceUrl: `https://example.com/${index}` },
    }));

    expect(() => prepareConnectorBatch(documents))
      .toThrowError(new ConnectorNormalizationError('too_many_documents'));
  });

  it('enforces the four MiB aggregate over normalized UTF-8 bytes', () => {
    const almost = 'a'.repeat(MAX_CONNECTOR_TEXT_BYTES - 1);
    expect(prepareConnectorBatch([{ title: 'large', text: almost, provenance }]).normalizedTextBytes)
      .toBe(MAX_CONNECTOR_TEXT_BYTES - 1);
    expect(() => prepareConnectorBatch([
      { title: 'large', text: almost, provenance },
      { title: 'unicode', text: '\u00a3', provenance: { ...provenance, sourceUrl: 'https://example.com/second' } },
    ])).toThrowError(new ConnectorNormalizationError('text_budget_exceeded'));
  });

  it('never carries raw provider or internal data into a prepared batch', () => {
    const batch = prepareConnectorBatch([{ title: 'safe', text: 'source text', provenance }]);
    const serialized = JSON.stringify(batch);

    expect(serialized).not.toContain('providerBody');
    expect(serialized).not.toContain('collection');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('email');
  });
});
