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
  { id: 'markdown', label: 'Markdown', group: 'FILES' },
  { id: 'text', label: 'Text', group: 'FILES' },
  { id: 'pdf', label: 'PDF', group: 'FILES' },
  { id: 'docx', label: 'DOCX', group: 'FILES' },
  { id: 'https_api', label: 'HTTPS API', group: 'DATA' },
  { id: 'webhook', label: 'Webhook', group: 'DATA' },
]);

export interface ConnectorCatalogueOptions {
  readonly webhookKey?: string | undefined;
  readonly fileImport?: boolean | undefined;
}

/**
 * The closed server-owned catalogue. Availability says whether a workflow can
 * be started on this deployment; it says nothing about a workspace's history.
 */
export function catalogue(options: ConnectorCatalogueOptions = {}): readonly ConnectorDescriptor[] {
  const webhookConfigured = typeof options.webhookKey === 'string' && options.webhookKey.trim() !== '';
  const fileConfigured = options.fileImport === true;
  return IMPLEMENTED.map((entry): ConnectorDescriptor => {
    const file = entry.group === 'FILES';
    const available = entry.id === 'webhook' ? webhookConfigured : !file || fileConfigured;
    return Object.freeze({
      ...entry,
      availability: available ? 'available' : 'unavailable',
      reason: available ? null : entry.id === 'webhook' ? 'signing_not_configured' : 'file_import_unavailable',
    });
  });
}

/** Merge durable observations without confusing successful one-off imports with connections. */
export function mergeConnectorState(
  descriptors: readonly ConnectorDescriptor[],
  observed: ConnectorWorkspaceState,
): readonly ConnectorStatus[] {
  return descriptors.map((descriptor): ConnectorStatus => {
    const observation = observed[descriptor.id] ?? EMPTY_OBSERVATION;
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
