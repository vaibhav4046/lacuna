import { File as NodeFile } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import { catalogue } from '../../src/connectors/catalog.js';
import type { ConnectorOutcome, ConnectorStatus, WebhookIssueResponse, WebhookState } from '../../web/src/api/connectors.js';
import {
  FileWorkflow,
  REVIEWED_OBSERVATION_COPY,
  ReviewedUrlWorkflow,
  WebhookLifecycleArbiter,
  canonicalGitHubReview,
  canonicalGitLabReview,
  safeHttpsReview,
  receiptReadiness,
} from '../../web/src/app/product-contracts.js';
import * as browserContracts from '../../web/src/app/product-contracts.js';
import { CONNECTOR_PRESENTATION } from '../../web/src/design/connectors.js';

function file(name: string, type: string): File {
  return new NodeFile(['source'], name, { type }) as unknown as File;
}

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve: (value: T) => resolve?.(value) };
}

const preview = {
  filename: 'notes.md', title: 'notes', type: 'markdown' as const, excerpt: 'bounded',
  characters: 7, pages: 0, paragraphs: 1, tables: 0,
  rawDigest: 'a'.repeat(64), normalizedDigest: 'b'.repeat(64),
  previewToken: `${'p'.repeat(64)}.${'A'.repeat(43)}`,
  expiresAt: '2026-08-21T12:05:00.000Z',
};

const baseReceipt = {
  connectorId: 'text' as const, submittedDocuments: 1, duplicateDocuments: 0,
  acceptedDocuments: 1, searchableDocuments: 1, failedDocuments: 0, emptyDocuments: 0,
  acceptedRecords: 4, refusedRecords: 0, failure: null,
  startedAt: '2026-08-21T12:00:00.000Z', completedAt: '2026-08-21T12:00:01.000Z',
  observationWrite: 'stored' as const, indeterminateSubmission: false,
};

async function renderConnectorComponent(name: string, props: Record<string, unknown>): Promise<string> {
  const react = await vi.importActual<Record<string, unknown>>('../../web/node_modules/react/index.js');
  const server = await vi.importActual<Record<string, unknown>>('../../web/node_modules/react-dom/server.js');
  const route = await vi.importActual<Record<string, unknown>>('../../web/src/app/routes/connectors.js');
  const createElement = Reflect.get(react, 'createElement');
  const renderToStaticMarkup = Reflect.get(server, 'renderToStaticMarkup');
  const component = Reflect.get(route, name);
  expect(createElement).toBeTypeOf('function');
  expect(renderToStaticMarkup).toBeTypeOf('function');
  expect(component).toBeTypeOf('function');
  if (typeof createElement !== 'function' || typeof renderToStaticMarkup !== 'function'
    || typeof component !== 'function') return '';
  return renderToStaticMarkup(createElement(component, props)) as string;
}

describe('private connector workflow contracts', () => {
  it('keeps the exact selected File through preview and consumes its in-memory token once', () => {
    const machine = new FileWorkflow();
    const original = file('notes.md', 'text/markdown');
    const replacement = file('notes.md', 'text/markdown');

    machine.select(original);
    expect(machine.beginPreview()).toBe(original);
    machine.finishPreview(original, { kind: 'receipt', value: preview });
    expect(machine.review?.file).toBe(original);
    expect(machine.beginImport()).toEqual({ file: original, previewToken: preview.previewToken });
    expect(machine.beginImport()).toBeNull();
    machine.finishImport();
    expect(machine.review).toBeNull();
    expect(machine.beginImport()).toBeNull();

    machine.select(replacement);
    expect(machine.review).toBeNull();
    machine.finishPreview(original, { kind: 'receipt', value: preview });
    expect(machine.review).toBeNull();
    machine.reset();
    expect(machine.selected).toBeNull();
  });

  it('maps an expired consumed preview to safe actionable re-preview copy', () => {
    const message = Reflect.get(browserContracts, 'connectorOutcomeMessage');
    expect(message).toBeTypeOf('function');
    if (typeof message !== 'function') return;
    expect(message({ kind: 'known_refusal', status: 409, code: 'preview_expired' }))
      .toBe('That preview expired. Preview the exact file again before importing.');
  });

  it('clears the native file input so the same file can be selected after a consumed preview', async () => {
    const route = await vi.importActual<Record<string, unknown>>('../../web/src/app/routes/connectors.js');
    const reset = Reflect.get(route, 'resetNativeFileSelection');
    expect(reset).toBeTypeOf('function');
    if (typeof reset !== 'function') return;

    const input = { value: '' } as HTMLInputElement;
    let changes = 0;
    const choose = (value: string) => {
      if (input.value === value) return;
      input.value = value;
      changes += 1;
    };
    const sameFile = 'C:\\fakepath\\notes.md';

    choose(sameFile);
    choose(sameFile);
    expect(changes).toBe(1);
    reset(input);
    expect(input.value).toBe('');
    choose(sameFile);
    expect(changes).toBe(2);

    expect(reset(null)).toBeUndefined();
  });

  it('maps every refusal category to closed safe actionable copy', () => {
    const message = Reflect.get(browserContracts, 'connectorOutcomeMessage');
    expect(message).toBeTypeOf('function');
    if (typeof message !== 'function') return;
    const cases = [
      ['session', 'Sign in again'],
      ['voice_binding', 'session changed'],
      ['permission', 'same-origin'],
      ['csrf', 'Refresh this page'],
      ['workspace_ingest_budget', 'import limit'],
      ['workspace_file_budget', 'file import limit'],
      ['github_no_documents', 'supported public text files'],
      ['https_address_blocked', 'different public HTTPS source'],
      ['https_type_unsupported', 'JSON, plain text, or Markdown'],
      ['webhook_state_unavailable', 'Refresh webhook state'],
      ['webhook_lifecycle_failed', 'Check authoritative webhook state'],
    ] as const;
    for (const [code, expected] of cases) {
      const copy = message({ kind: 'known_refusal', status: 400, code });
      expect(copy).toContain(expected);
      expect(copy).not.toContain('This request was safely refused');
      expect(copy).not.toMatch(/provider|stack|collection|workspace id|email|cookie|token value|IP address/iu);
    }
  });

  it('reviews GitHub and HTTPS locally and permits each confirmation once', () => {
    expect(canonicalGitHubReview('HTTPS://github.com/Acme/Atlas')).toBeNull();
    expect(canonicalGitHubReview('https://github.com/acme-/atlas')).toBeNull();
    expect(canonicalGitHubReview('https://github.com/acme--labs/atlas')).toBeNull();
    expect(canonicalGitHubReview('https://github.com/acme/.atlas')).toBe('https://github.com/acme/.atlas');
    expect(canonicalGitHubReview('https://github.com/acme/atlas')).toBe('https://github.com/acme/atlas');
    // Mixed case is canonicalised rather than refused, which is what the
    // server has always done. Refusing it left a reader who pasted the address
    // GitHub itself shows with a dead end and no way to learn the fix.
    expect(canonicalGitHubReview('https://github.com/octocat/Hello-World')).toBe('https://github.com/octocat/hello-world');
    expect(canonicalGitHubReview('https://github.com/Acme/Atlas.git')).toBe('https://github.com/acme/atlas');
    expect(canonicalGitLabReview('https://gitlab.com/Group/Sub/Project')).toBe('https://gitlab.com/group/sub/project');
    // The scheme is still matched literally, so an uppercase one is not a URL
    // this reviews.
    expect(canonicalGitHubReview('HTTPS://github.com/acme/atlas')).toBeNull();
    expect(safeHttpsReview('https://api.example.test/data?credential=hidden')).toEqual({
      submitted: 'https://api.example.test/data?credential=hidden',
      displayed: 'https://api.example.test/data',
      queryPresent: true,
    });

    const github = new ReviewedUrlWorkflow(canonicalGitHubReview);
    github.edit('https://github.com/acme/atlas');
    expect(github.review()).toBe(true);
    expect(github.confirm()).toBe('https://github.com/acme/atlas');
    expect(github.confirm()).toBeNull();
    github.edit('https://github.com/acme/other');
    expect(github.confirm()).toBeNull();
  });

  it('uses exact non-cumulative recorded-observation labels and four independent file ids', () => {
    expect(REVIEWED_OBSERVATION_COPY.importedDocuments).toBe('RECORDED ACCEPTED DOCUMENTS');
    expect(REVIEWED_OBSERVATION_COPY.lastSuccessAt).toBe('LAST RECORDED ACCEPTANCE');
    expect(REVIEWED_OBSERVATION_COPY.mayLag).toContain('may lag');
    expect(JSON.stringify(REVIEWED_OBSERVATION_COPY).toLowerCase()).not.toMatch(/cumulative|latest total/);

    const files = CONNECTOR_PRESENTATION.filter((item) => item.workflow === 'file');
    expect(files).toHaveLength(4);
    expect(files.map((item) => item.serverIds)).toEqual([
      ['markdown'], ['text'], ['pdf'], ['docx'],
    ]);
  });

  it('maps every implemented presentation entry to the closed server catalogue exactly once', () => {
    const server = catalogue({ webhookService: true, fileImport: true, githubImport: true, httpsImport: true });
    const mapped = CONNECTOR_PRESENTATION
      .filter((item) => item.implementation === 'implemented')
      .flatMap((item) => item.serverIds);
    expect(mapped).toEqual(server.map((item) => item.id));
    expect(new Set(mapped).size).toBe(mapped.length);
  });

  it('never calls accepted-but-unsearchable or indeterminate work readiness confirmed', () => {
    expect(receiptReadiness(baseReceipt)).toBe('confirmed');
    expect(receiptReadiness({ ...baseReceipt, searchableDocuments: 0 })).toBe('not confirmed');
    expect(receiptReadiness({ ...baseReceipt, acceptedDocuments: 0, searchableDocuments: 0, duplicateDocuments: 1 })).toBe('not applicable');
    expect(receiptReadiness({
      ...baseReceipt, acceptedDocuments: 0, searchableDocuments: 0,
      failure: 'transport_failed', indeterminateSubmission: true,
    })).toBe('submission indeterminate; not confirmed');
  });

  it('clears an old receipt and reference at the dispatch of every new import operation', () => {
    const reduce = Reflect.get(browserContracts, 'connectorReceiptPresentation');
    expect(reduce).toBeTypeOf('function');
    if (typeof reduce !== 'function') return;
    const shown = reduce(null, { type: 'received', receipt: baseReceipt, reference: 'a'.repeat(64) });
    expect(shown).toEqual({ receipt: baseReceipt, reference: 'a'.repeat(64) });
    for (const connector of ['file-preview', 'file-import', 'github', 'https'] as const) {
      expect(reduce(shown, { type: 'dispatched', connector })).toBeNull();
    }
  });

  it('renders exact receipt variants with an operation identity rather than stale unlabeled success', async () => {
    const searchable = await renderConnectorComponent('ReceiptSummary', {
      receipt: baseReceipt, reference: 'a'.repeat(64),
    });
    const incomplete = await renderConnectorComponent('ReceiptSummary', {
      receipt: { ...baseReceipt, searchableDocuments: 0, failure: 'readiness_timeout' },
      reference: 'b'.repeat(64),
    });
    const indeterminate = await renderConnectorComponent('ReceiptSummary', {
      receipt: {
        ...baseReceipt, acceptedDocuments: 0, searchableDocuments: 0,
        failure: 'receipt_refused', indeterminateSubmission: true,
      },
      reference: null,
    });
    expect(searchable).toContain('Accepted and searchable');
    expect(searchable).toContain('TEXT · 2026-08-21T12:00:00.000Z');
    expect(incomplete).toContain('Accepted; search readiness incomplete');
    expect(incomplete).toContain('Readiness: not confirmed');
    expect(incomplete).toContain('Accepted documents are stored. Search indexing has not been confirmed yet');
    expect(incomplete).toContain('failure detail: readiness_timeout');
    expect(indeterminate).toContain('Submission outcome indeterminate');
    expect(indeterminate).toContain('submission indeterminate; not confirmed');

    const partial = await renderConnectorComponent('ReceiptSummary', {
      receipt: {
        ...baseReceipt, submittedDocuments: 2, failedDocuments: 1,
        failure: 'parse_failed',
      },
      reference: 'c'.repeat(64),
    });
    expect(partial).toContain('Accepted and searchable');
    expect(partial).toContain('Readiness: confirmed');
    expect(partial).toContain('1 submitted document failed');
    expect(partial).not.toContain('search readiness incomplete');

    const failedOnly = await renderConnectorComponent('ReceiptSummary', {
      receipt: {
        ...baseReceipt, acceptedDocuments: 0, searchableDocuments: 0, acceptedRecords: 0,
        failedDocuments: 1, failure: 'parse_failed',
      },
      reference: null,
    });
    expect(failedOnly).toContain('No accepted document');
    expect(failedOnly).toContain('1 submitted document failed.');
    expect(failedOnly).not.toContain('searchable acceptance');
  });

  it('renders checking and unknown separately from an explicitly unavailable catalogue entry', async () => {
    const checking = await renderConnectorComponent('ConnectorAvailabilityNotice', {
      catalogueState: 'loading', connector: null, unavailableCopy: 'GitHub import is unavailable on this deployment.',
    });
    const unknown = await renderConnectorComponent('ConnectorAvailabilityNotice', {
      catalogueState: 'unknown', connector: null, unavailableCopy: 'GitHub import is unavailable on this deployment.',
    });
    const unavailable = await renderConnectorComponent('ConnectorAvailabilityNotice', {
      catalogueState: 'ready', connector: {
        id: 'github', label: 'GitHub', group: 'CODE', availability: 'unavailable',
        reason: 'github_import_unavailable', configuredAt: null, lastAttemptAt: null,
        lastSuccessAt: null, lastFailure: null, importedDocuments: 0, state: 'idle',
      }, unavailableCopy: 'GitHub import is unavailable on this deployment.',
    });
    expect(checking).toContain('CHECKING');
    expect(checking).not.toContain('unavailable on this deployment');
    expect(unknown).toContain('UNKNOWN');
    expect(unknown).not.toContain('unavailable on this deployment');
    expect(unavailable).toContain('GitHub import is unavailable on this deployment.');
  });

  it('renders the required recorded failure alongside may-lag observation labels', async () => {
    const catalogue = { connectors: [{
      id: 'github', label: 'GitHub', group: 'CODE', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: '2026-08-21T12:00:00.000Z', lastSuccessAt: null,
      lastFailure: 'readiness_failed', importedDocuments: 0, state: 'failed',
    }] };
    const html = await renderConnectorComponent('Observation', { catalogue, catalogueState: 'ready' });
    expect(html).toContain('LAST RECORDED FAILURE');
    expect(html).toContain('readiness_failed');
    expect(html).toContain('Recorded observations may lag');
  });

  it('shows accepted documents with unconfirmed readiness as syncing, not failed', async () => {
    const catalogue = { connectors: [{
      id: 'https_api', label: 'HTTPS API', group: 'DATA', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: '2026-08-21T12:00:00.000Z', lastSuccessAt: '2026-08-21T12:00:00.000Z',
      lastFailure: 'readiness_failed', importedDocuments: 3, state: 'failed',
    }] };
    const html = await renderConnectorComponent('Observation', { catalogue, catalogueState: 'ready' });
    expect(html).toContain('SYNCING');
    expect(html).not.toContain('>FAILED<');
    expect(html).toContain('Accepted documents are stored; search indexing has not been confirmed.');
  });

  it('closes an already-open VoiceDock before rendering the one secret dialog owner', async () => {
    const transition = Reflect.get(browserContracts, 'revealExclusiveSecret');
    expect(transition).toBeTypeOf('function');
    if (typeof transition !== 'function') return;
    let dockOpen = true;
    let secretVisible = false;
    const order: string[] = [];
    transition(
      () => { dockOpen = false; order.push('dock-closed'); },
      () => { expect(dockOpen).toBe(false); secretVisible = true; order.push('secret-revealed'); },
      (commit: () => void) => commit(),
    );
    expect({ dockOpen, secretVisible, order }).toEqual({
      dockOpen: false, secretVisible: true, order: ['dock-closed', 'secret-revealed'],
    });

    const dialog = await renderConnectorComponent('WebhookSecretDialog', {
      issued: {
        created: true, endpointId: 'A'.repeat(22),
        endpoint: `https://app.example.test/api/connectors/webhook/${'A'.repeat(22)}`,
        secret: 'A'.repeat(43), configuredAt: '2026-08-21T12:00:00.000Z',
      }, acknowledge: () => undefined, copy: () => undefined, copyState: '',
    });
    expect(dialog.match(/aria-modal="true"/gu)).toHaveLength(1);
    expect(dialog).toContain('Save this webhook secret now.');
  });

  it('fails closed to manual selection when clipboard is absent, throws, or rejects', async () => {
    const copy = Reflect.get(browserContracts, 'copyConnectorSecret');
    expect(copy).toBeTypeOf('function');
    if (typeof copy !== 'function') return;
    const secret = 'A'.repeat(43);
    await expect(copy(secret, undefined)).resolves.toBe(false);
    await expect(copy(secret, () => { throw new Error('blocked'); })).resolves.toBe(false);
    await expect(copy(secret, async () => { throw new Error('blocked'); })).resolves.toBe(false);
    const writer = vi.fn(async () => undefined);
    await expect(copy(secret, writer)).resolves.toBe(true);
    expect(writer).toHaveBeenCalledWith(secret);
  });

  it('renders the process-local replay limit in the actual file workflow copy', async () => {
    const html = await renderConnectorComponent('FileReplayCopy', {});
    expect(html).toContain('process-local replay protection');
    expect(html).not.toContain('one-time token');
  });

  it('keeps one focusable guarded webhook trigger through issue, revoke, readback, and lost-response states', async () => {
    const connector = {
      id: 'webhook', label: 'Webhook', group: 'DATA', availability: 'available', reason: null,
      configuredAt: null, lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'idle',
    } satisfies ConnectorStatus;
    const configured = {
      configured: true, endpointId: 'A'.repeat(22),
      endpoint: `https://app.example.test/api/connectors/webhook/${'A'.repeat(22)}`,
      configuredAt: '2026-08-21T12:00:00.000Z',
    } satisfies WebhookState;
    for (const state of [
      { pending: 'webhook', webhook: null, needsRefresh: false },
      { pending: 'webhook-revoke', webhook: configured, needsRefresh: false },
      { pending: 'webhook-state', webhook: null, needsRefresh: false },
      { pending: null, webhook: null, needsRefresh: true },
    ] as const) {
      const html = await renderConnectorComponent('WebhookLifecycleControl', {
        connector, ...state, confirmRevoke: null,
        triggerRef: { current: null }, onSetup: () => undefined, onRequestRevoke: () => undefined,
        onConfirmRevoke: () => undefined, onCancelRevoke: () => undefined, onRefresh: () => undefined,
      });
      expect(html.match(/data-webhook-lifecycle-trigger="1"/gu)).toHaveLength(1);
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toContain('disabled=""');
    }
  });

  it('commits cancel, confirm, success, and indeterminate transitions before refocusing the exact trigger', () => {
    const commitAndFocus = Reflect.get(browserContracts, 'commitAndRestoreWebhookTrigger');
    expect(commitAndFocus).toBeTypeOf('function');
    if (typeof commitAndFocus !== 'function') return;
    const order: string[] = [];
    const trigger = {
      isConnected: true,
      focus: () => { order.push('focus'); },
    };
    for (const transition of ['cancel', 'confirm', 'success', 'indeterminate']) {
      expect(commitAndFocus(
        () => { order.push(`${transition}-commit`); },
        (commit: () => void) => commit(),
        trigger,
      )).toBe(true);
    }
    expect(order).toEqual([
      'cancel-commit', 'focus',
      'confirm-commit', 'focus',
      'success-commit', 'focus',
      'indeterminate-commit', 'focus',
    ]);
  });

  it('retains the exact issue trigger through post-reveal catalogue refresh and restores it on acknowledge', async () => {
    const reduceCatalogue = Reflect.get(browserContracts, 'connectorCataloguePresentation');
    const restoreFocus = Reflect.get(browserContracts, 'restoreExactModalFocus');
    expect(reduceCatalogue).toBeTypeOf('function');
    expect(restoreFocus).toBeTypeOf('function');
    if (typeof reduceCatalogue !== 'function' || typeof restoreFocus !== 'function') return;
    const webhookConnector = {
      id: 'webhook', label: 'Webhook', group: 'DATA', availability: 'available', reason: null,
      configuredAt: '2026-08-21T12:00:00.000Z', lastAttemptAt: null, lastSuccessAt: null, lastFailure: null,
      importedDocuments: 0, state: 'connected',
    } satisfies ConnectorStatus;
    let presentation = reduceCatalogue({ catalogue: null, state: 'loading' }, { type: 'received', catalogue: { connectors: [webhookConnector] } });
    presentation = reduceCatalogue(presentation, { type: 'started' });
    const refreshing = await renderConnectorComponent('WebhookLifecycleControl', {
      connector: presentation.catalogue?.connectors[0] ?? null, catalogueState: presentation.state,
      webhook: {
        configured: true, endpointId: 'A'.repeat(22),
        endpoint: `https://app.example.test/api/connectors/webhook/${'A'.repeat(22)}`,
        configuredAt: '2026-08-21T12:00:00.000Z',
      }, pending: null, needsRefresh: false, confirmRevoke: null,
      triggerRef: { current: null }, onSetup: () => undefined, onRequestRevoke: () => undefined,
      onConfirmRevoke: () => undefined, onCancelRevoke: () => undefined, onRefresh: () => undefined,
    });
    expect(refreshing).toContain('data-webhook-lifecycle-trigger="1"');
    expect(refreshing).toContain('aria-disabled="true"');
    expect(refreshing).toContain('CHECKING');
    let pendingFocus = 0;
    expect(restoreFocus({ isConnected: true, disabled: false, focus: () => { pendingFocus += 1; } })).toBe(true);
    expect(pendingFocus).toBe(1);

    const failedPresentation = reduceCatalogue(presentation, { type: 'failed' });
    const failed = await renderConnectorComponent('WebhookLifecycleControl', {
      connector: failedPresentation.catalogue?.connectors[0] ?? null, catalogueState: failedPresentation.state,
      webhook: {
        configured: true, endpointId: 'A'.repeat(22),
        endpoint: `https://app.example.test/api/connectors/webhook/${'A'.repeat(22)}`,
        configuredAt: '2026-08-21T12:00:00.000Z',
      }, pending: null, needsRefresh: false, confirmRevoke: null,
      triggerRef: { current: null }, onSetup: () => undefined, onRequestRevoke: () => undefined,
      onConfirmRevoke: () => undefined, onCancelRevoke: () => undefined, onRefresh: () => undefined,
    });
    expect(failed).toContain('aria-disabled="true"');
    expect(failed).toContain('UNKNOWN');
    let failedFocus = 0;
    expect(restoreFocus({ isConnected: true, disabled: false, focus: () => { failedFocus += 1; } })).toBe(true);
    expect(failedFocus).toBe(1);

    presentation = reduceCatalogue(presentation, { type: 'received', catalogue: { connectors: [webhookConnector] } });
    let focused = 0;
    const trigger = { isConnected: true, disabled: false, focus: () => { focused += 1; } };
    expect(restoreFocus(trigger)).toBe(true);
    expect(focused).toBe(1);
  });

  it('associates a safe workflow error only with its owning keyboard input', async () => {
    const html = await renderConnectorComponent('ConnectorUrlField', {
      id: 'github-url', instructionsId: 'github-instructions', errorId: 'github-error',
      label: 'CANONICAL REPOSITORY ROOT', name: 'public-github-repository',
      value: 'not-a-repository', placeholder: 'https://github.com/owner/repository',
      problem: 'Enter one canonical lowercase public GitHub repository root.',
      disabled: false, onChange: () => undefined,
    });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="github-instructions github-error"');
    expect(html).toContain('id="github-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('https-api-error');
  });

  it('renders an associated file error immediately when accept-hint bypass selects an unsupported file', async () => {
    const selectionProblem = Reflect.get(browserContracts, 'fileSelectionProblem');
    expect(selectionProblem).toBeTypeOf('function');
    if (typeof selectionProblem !== 'function') return;
    const problem = selectionProblem(file('archive.exe', 'application/octet-stream'));
    expect(problem).toBe('Choose one .txt, .md, .json, .csv, .pdf, or .docx file smaller than 8 MiB.');
    const html = await renderConnectorComponent('FileSourceField', {
      problem, disabled: false, onSelect: () => undefined,
    });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="file-instructions connector-file-error"');
    expect(html).toContain('id="connector-file-error"');
    expect(html).toContain('role="alert"');
  });

  it('renders functional stable Explore anchor targets and accepts only the closed hash set', async () => {
    const html = await renderConnectorComponent('ExploreConnectors', {});
    for (const id of ['file', 'github', 'https-api', 'webhook']) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`tabindex="-1"`);
    }
    const target = Reflect.get(browserContracts, 'connectorAnchorTarget');
    expect(target).toBeTypeOf('function');
    if (typeof target !== 'function') {
      return;
    }
    expect(target('#file')).toBe('file');
    expect(target('#gitlab')).toBe('gitlab');
    expect(target('#https-api')).toBe('https-api');
    expect(target('#File')).toBeNull();
    expect(target('#unknown')).toBeNull();
  });
});

describe('webhook issue/state arbitration', () => {
  const endpointId = 'A'.repeat(22);
  const endpoint = `https://app.example.test/api/connectors/webhook/${endpointId}`;
  const configuredAt = '2026-08-21T12:00:00.000Z';
  const issue: WebhookIssueResponse = {
    created: true, endpointId, endpoint, secret: 'A'.repeat(43), configuredAt,
  };
  const state: WebhookState = { configured: true, endpointId, endpoint, configuredAt };

  it('destroys a late E1 secret when an E2 authoritative pointer wins', async () => {
    const firstIssue = deferred<ConnectorOutcome<WebhookIssueResponse>>();
    const reads = [
      Promise.resolve<ConnectorOutcome<WebhookState>>({
        kind: 'receipt', value: {
          configured: true, endpointId: 'C'.repeat(22),
          endpoint: `https://app.example.test/api/connectors/webhook/${'C'.repeat(22)}`,
          configuredAt: '2026-08-21T12:01:00.000Z',
        },
      }),
    ];
    const revealed = vi.fn();
    const observed = vi.fn();
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => await firstIssue.promise,
      read: async () => await (reads.shift() ?? Promise.resolve({ kind: 'indeterminate' as const })),
      revoke: async () => ({ kind: 'indeterminate' }),
      onReveal: revealed,
      onState: observed,
    });

    const e1 = arbiter.issue();
    await arbiter.refresh();
    firstIssue.resolve({ kind: 'receipt', value: issue });
    await e1;

    expect(revealed).not.toHaveBeenCalled();
    expect(observed).toHaveBeenLastCalledWith(expect.objectContaining({ endpointId: 'C'.repeat(22) }));
  });

  it('reveals a created secret only after one exact authoritative readback', async () => {
    const revealed = vi.fn();
    const read = vi.fn(async (): Promise<ConnectorOutcome<WebhookState>> => ({ kind: 'receipt', value: state }));
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => ({ kind: 'receipt', value: issue }), read,
      revoke: async () => ({ kind: 'receipt', value: { revoked: true } }),
      onReveal: revealed, onState: vi.fn(),
    });

    await arbiter.issue();
    expect(read).toHaveBeenCalledTimes(1);
    expect(revealed).toHaveBeenCalledWith(issue);
  });

  it('never reveals on mismatch/loss and always reconciles once after revoke', async () => {
    const revealed = vi.fn();
    const read = vi.fn()
      .mockResolvedValueOnce({ kind: 'indeterminate' })
      .mockResolvedValueOnce({ kind: 'receipt', value: state });
    const revoke = vi.fn(async () => ({ kind: 'known_refusal' as const, status: 404, code: 'webhook_not_found' as const }));
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => ({ kind: 'receipt', value: issue }), read, revoke,
      onReveal: revealed, onState: vi.fn(),
    });

    await arbiter.issue();
    expect(revealed).not.toHaveBeenCalled();
    arbiter.adopt(state);
    await arbiter.revoke(arbiter.captureRevoke());
    expect(revoke).toHaveBeenCalledWith(endpointId);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('clears stale authoritative state on indeterminate mutation and requires a successful refresh', async () => {
    const observed = vi.fn();
    const revoke = vi.fn(async (): Promise<ConnectorOutcome<{ readonly revoked: true }>> => ({
      kind: 'receipt', value: { revoked: true },
    }));
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => ({ kind: 'indeterminate' }),
      read: async () => ({ kind: 'indeterminate' }),
      revoke,
      onReveal: vi.fn(),
      onState: observed,
    });
    arbiter.adopt(state);

    await arbiter.issue();
    expect(observed).toHaveBeenLastCalledWith(null);
    await arbiter.revoke(arbiter.captureRevoke());
    expect(revoke).not.toHaveBeenCalled();
  });

  it('cannot revoke E2 through a confirmation captured for E1', async () => {
    const revoke = vi.fn(async (): Promise<ConnectorOutcome<{ readonly revoked: true }>> => ({
      kind: 'receipt', value: { revoked: true },
    }));
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => ({ kind: 'indeterminate' }),
      read: async () => ({ kind: 'indeterminate' }),
      revoke,
      onReveal: vi.fn(), onState: vi.fn(),
    });
    arbiter.adopt(state);
    const e1Confirmation = arbiter.captureRevoke();
    expect(e1Confirmation).toEqual({ endpointId, generation: expect.any(Number) });
    arbiter.adopt({
      configured: true, endpointId: 'C'.repeat(22),
      endpoint: `https://app.example.test/api/connectors/webhook/${'C'.repeat(22)}`,
      configuredAt: '2026-08-21T12:01:00.000Z',
    });

    await expect(arbiter.revoke(e1Confirmation)).resolves.toBe('indeterminate');
    expect(revoke).not.toHaveBeenCalled();
  });

  it('preserves an issue refusal while reconciling configured-false and same-pointer state once', async () => {
    const unconfigured: WebhookState = {
      configured: false, endpointId: null, endpoint: null, configuredAt: null,
    };
    const cases = [unconfigured, state];
    for (const authoritative of cases) {
      const issueRequest = vi.fn(async (): Promise<ConnectorOutcome<WebhookIssueResponse>> => ({
        kind: 'known_refusal', status: 429, code: 'workspace_ingest_budget',
      }));
      const read = vi.fn(async (): Promise<ConnectorOutcome<WebhookState>> => ({
        kind: 'receipt', value: authoritative,
      }));
      const observed = vi.fn();
      const arbiter = new WebhookLifecycleArbiter({
        issue: issueRequest, read, revoke: async () => ({ kind: 'indeterminate' }),
        onReveal: vi.fn(), onState: observed,
      });

      await expect(arbiter.issue()).resolves.toEqual({
        kind: 'known_refusal', status: 429, code: 'workspace_ingest_budget', reconciled: true,
      });
      expect(issueRequest).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(observed).toHaveBeenLastCalledWith(authoritative);
    }
  });

  it('preserves a revoke refusal while retaining the reconciled same pointer', async () => {
    const revoke = vi.fn(async (): Promise<ConnectorOutcome<{ readonly revoked: true }>> => ({
      kind: 'known_refusal', status: 403, code: 'csrf',
    }));
    const observed = vi.fn();
    const arbiter = new WebhookLifecycleArbiter({
      issue: async () => ({ kind: 'indeterminate' }),
      read: async () => ({ kind: 'receipt', value: state }), revoke,
      onReveal: vi.fn(), onState: observed,
    });
    arbiter.adopt(state);

    await expect(arbiter.revoke(arbiter.captureRevoke())).resolves.toEqual({
      kind: 'known_refusal', status: 403, code: 'csrf', reconciled: true,
    });
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenLastCalledWith(state);
  });
});
