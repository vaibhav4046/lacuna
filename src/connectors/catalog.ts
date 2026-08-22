import type {
  ConnectorDescriptor,
  ConnectorObservation,
  ConnectorStatus,
  ConnectorWorkspaceState,
} from './types.js';

const EMPTY_OBSERVATION: ConnectorObservation = Object.freeze({
  configuredAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFailure: null,
  importedDocuments: 0,
});

const IMPLEMENTED: readonly Omit<ConnectorDescriptor, 'availability' | 'reason'>[] = Object.freeze([
  { id: 'github', label: 'GitHub', group: 'CODE' },
  { id: 'gitlab', label: 'GitLab', group: 'CODE' },
  { id: 'markdown', label: 'Markdown', group: 'FILES' },
  { id: 'text', label: 'Text', group: 'FILES' },
  { id: 'pdf', label: 'PDF', group: 'FILES' },
  { id: 'docx', label: 'DOCX', group: 'FILES' },
  { id: 'https_api', label: 'HTTPS API', group: 'DATA' },
  { id: 'webhook', label: 'Webhook', group: 'DATA' },
]);

export interface ConnectorCatalogueOptions {
  readonly webhookService?: boolean | undefined;
  readonly fileImport?: boolean | undefined;
  readonly githubImport?: boolean | undefined;
  readonly gitlabImport?: boolean | undefined;
  readonly httpsImport?: boolean | undefined;
}

/**
 * The closed server-owned catalogue. Availability says whether a workflow can
 * be started on this deployment; it says nothing about a workspace's history.
 */
export function catalogue(options: ConnectorCatalogueOptions = {}): readonly ConnectorDescriptor[] {
  const webhookConfigured = options.webhookService === true;
  const fileConfigured = options.fileImport === true;
  const githubConfigured = options.githubImport === true;
  const gitlabConfigured = options.gitlabImport === true;
  const httpsConfigured = options.httpsImport === true;
  return IMPLEMENTED.map((entry): ConnectorDescriptor => {
    const file = entry.group === 'FILES';
    const available = entry.id === 'webhook' ? webhookConfigured
      : entry.id === 'github' ? githubConfigured
        : entry.id === 'gitlab' ? gitlabConfigured
        : entry.id === 'https_api' ? httpsConfigured
        : !file || fileConfigured;
    return Object.freeze({
      ...entry,
      availability: available ? 'available' : 'unavailable',
      reason: available ? null
        : entry.id === 'webhook' ? 'signing_not_configured'
          : entry.id === 'github' ? 'github_import_unavailable'
            : entry.id === 'gitlab' ? 'gitlab_import_unavailable'
            : entry.id === 'https_api' ? 'https_import_unavailable'
            : 'file_import_unavailable',
    });
  });
}

/** Merge durable observations without confusing successful one-off imports with connections. */
export function mergeConnectorState(
  descriptors: readonly ConnectorDescriptor[],
  observed: ConnectorWorkspaceState,
  authoritative: { readonly webhookConfiguredAt?: string | null } = {},
): readonly ConnectorStatus[] {
  return descriptors.map((descriptor): ConnectorStatus => {
    const held = observed[descriptor.id] ?? EMPTY_OBSERVATION;
    const observation = descriptor.id === 'webhook'
      && Object.prototype.hasOwnProperty.call(authoritative, 'webhookConfiguredAt')
      ? { ...held, configuredAt: authoritative.webhookConfiguredAt ?? null }
      : held;
    const state = observation.lastFailure !== null
      ? 'failed'
      : descriptor.id === 'webhook'
        && descriptor.availability === 'available'
        && observation.configuredAt !== null
        ? 'connected'
        : 'idle';
    return Object.freeze({ ...descriptor, ...observation, state });
  });
}
