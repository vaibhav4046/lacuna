import { describe, expect, it } from 'vitest';

import { catalogue, mergeConnectorState } from '../../src/connectors/catalog.js';
import { CONNECTOR_GROUPS, CONNECTOR_PRESENTATION } from '../../web/src/design/connectors.js';

describe('connector catalogue', () => {
  it('publishes each implemented connector exactly once with a usable label and group', () => {
    const entries = catalogue({ webhookService: true, fileImport: true, githubImport: true, gitlabImport: true, httpsImport: true, slackImport: true, workImport: true });

    expect(entries.map((entry) => entry.id)).toEqual([
      'github', 'gitlab', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook', 'slack',
      'notion', 'jira', 'confluence', 'gmail',
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(entries.every((entry) => entry.label.trim() !== '' && entry.group.trim() !== '')).toBe(true);
    expect(entries.every((entry) => entry.availability === 'available')).toBe(true);
  });

  it('keeps the private runtime catalogue and the UI implementation map in lockstep', () => {
    const entries = catalogue({ webhookService: true, fileImport: true, githubImport: true, gitlabImport: true, httpsImport: true, slackImport: true });
    const runtime = new Map(entries.map((entry) => [entry.id, entry]));
    const presentation = CONNECTOR_PRESENTATION.filter((entry) => entry.implementation === 'implemented');
    const presentationIds = presentation.flatMap((entry) => entry.serverIds);

    expect(new Set(presentationIds)).toEqual(new Set(runtime.keys()));
    for (const entry of presentation) {
      const id = entry.serverIds[0];
      expect(id, entry.name).toBeDefined();
      const descriptor = id === undefined ? undefined : runtime.get(id);
      expect(descriptor, entry.name).toMatchObject({ label: entry.name, group: entry.group });
    }
  });

  it('fails the webhook closed when deployment signing is not configured', () => {
    expect(catalogue({ webhookService: false }).find((entry) => entry.id === 'webhook'))
      .toMatchObject({ availability: 'unavailable', reason: 'signing_not_configured' });
    expect(catalogue({}).find((entry) => entry.id === 'webhook'))
      .toMatchObject({ availability: 'unavailable', reason: 'signing_not_configured' });
  });

  it('fails public GitHub import closed unless its importer and runner are both available', () => {
    expect(catalogue({ githubImport: false }).find((entry) => entry.id === 'github'))
      .toMatchObject({ availability: 'unavailable', reason: 'github_import_unavailable' });
    expect(catalogue({ githubImport: true }).find((entry) => entry.id === 'github'))
      .toMatchObject({ availability: 'available', reason: null });
  });

  it('fails public GitLab import closed unless its importer and runner are both available', () => {
    expect(catalogue({ gitlabImport: false }).find((entry) => entry.id === 'gitlab'))
      .toMatchObject({ availability: 'unavailable', reason: 'gitlab_import_unavailable' });
    expect(catalogue({ gitlabImport: true }).find((entry) => entry.id === 'gitlab'))
      .toMatchObject({ availability: 'available', reason: null });
  });

  it('fails public HTTPS import closed unless its pinned reader and runner are both available', () => {
    expect(catalogue({ httpsImport: false }).find((entry) => entry.id === 'https_api'))
      .toMatchObject({ availability: 'unavailable', reason: 'https_import_unavailable' });
    expect(catalogue({ httpsImport: true }).find((entry) => entry.id === 'https_api'))
      .toMatchObject({ availability: 'available', reason: null });
  });

  it('uses authoritative active-index state rather than a stale connector observation for connected', () => {
    const descriptors = catalogue({ webhookService: true });
    const observed = {
      webhook: {
        configuredAt: '2026-08-20T00:00:00.000Z',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailure: null,
        importedDocuments: 0,
      },
    } as const;
    expect(mergeConnectorState(descriptors, observed, { webhookConfiguredAt: null })
      .find((entry) => entry.id === 'webhook')).toMatchObject({ state: 'idle', configuredAt: null });
    expect(mergeConnectorState(descriptors, {}, { webhookConfiguredAt: '2026-08-21T12:00:00.000Z' })
      .find((entry) => entry.id === 'webhook')).toMatchObject({
        state: 'connected', configuredAt: '2026-08-21T12:00:00.000Z',
      });
  });

  it('keeps unimplemented account integrations planned in the public design vocabulary', () => {
    const publicStates = new Map(
      CONNECTOR_GROUPS.flatMap((group) => group.items.map((item) => [item.n, item.st] as const)),
    );

    // Slack left this list the day a real importer shipped, and Notion, Jira,
    // Confluence and Gmail followed it: one bounded read of one item with the
    // caller's own credential, no OAuth application of ours. Linear stays
    // here because it still has no adapter, and a word must be earned.
    expect(publicStates.get('Linear'), 'Linear').toBe('PLANNED');
    for (const name of ['Slack', 'Notion', 'Jira', 'Confluence', 'Gmail']) {
      expect(publicStates.get(name), name).toBe('IMPLEMENTED');
    }
  });
});
