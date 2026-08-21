import { describe, expect, it } from 'vitest';

import { catalogue } from '../../src/connectors/catalog.js';
import { CONNECTOR_GROUPS } from '../../web/src/design/connectors.js';

describe('connector catalogue', () => {
  it('publishes each implemented connector exactly once with a usable label and group', () => {
    const entries = catalogue({ webhookKey: 'configured', fileImport: true, githubImport: true });

    expect(entries.map((entry) => entry.id)).toEqual([
      'github', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.every((entry) => entry.label.trim() !== '' && entry.group.trim() !== '')).toBe(true);
    expect(entries.every((entry) => entry.availability === 'available')).toBe(true);
  });

  it('fails the webhook closed when deployment signing is not configured', () => {
    expect(catalogue({ webhookKey: undefined }).find((entry) => entry.id === 'webhook'))
      .toMatchObject({ availability: 'unavailable', reason: 'signing_not_configured' });
    expect(catalogue({ webhookKey: '' }).find((entry) => entry.id === 'webhook'))
      .toMatchObject({ availability: 'unavailable', reason: 'signing_not_configured' });
  });

  it('fails public GitHub import closed unless its importer and runner are both available', () => {
    expect(catalogue({ githubImport: false }).find((entry) => entry.id === 'github'))
      .toMatchObject({ availability: 'unavailable', reason: 'github_import_unavailable' });
    expect(catalogue({ githubImport: true }).find((entry) => entry.id === 'github'))
      .toMatchObject({ availability: 'available', reason: null });
  });

  it('keeps unimplemented account integrations planned in the public design vocabulary', () => {
    const publicStates = new Map(
      CONNECTOR_GROUPS.flatMap((group) => group.items.map((item) => [item.n, item.st] as const)),
    );

    for (const name of ['GitLab', 'Slack', 'Notion', 'Gmail', 'Linear', 'Jira', 'Confluence']) {
      expect(publicStates.get(name), name).toBe('PLANNED');
    }
  });
});
