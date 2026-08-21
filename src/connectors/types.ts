export type ConnectorId = 'github' | 'markdown' | 'text' | 'pdf' | 'docx' | 'https_api' | 'webhook';

export type ConnectorAvailability = 'available' | 'unavailable';

/** `syncing` is process-local presentation state and is never durable. */
export type ConnectorRunState = 'idle' | 'syncing' | 'connected' | 'failed';

/** Stable client-safe failures. Provider messages and response bodies never enter this vocabulary. */
export type ConnectorFailureCode =
  | 'validation_failed'
  | 'transport_failed'
  | 'parse_failed'
  | 'receipt_refused'
  | 'readiness_failed'
  | 'readiness_timeout'
  | 'signing_not_configured';

export type ConnectorAvailabilityReason = 'signing_not_configured';

export type ConnectorGroup = 'CODE' | 'FILES' | 'DATA';

export interface ConnectorDescriptor {
  readonly id: ConnectorId;
  readonly label: string;
  readonly group: ConnectorGroup;
  readonly availability: ConnectorAvailability;
  readonly reason: ConnectorAvailabilityReason | null;
}

/** Bounded, non-secret evidence of completed connector work. */
export interface ConnectorObservation {
  readonly configuredAt: string | null;
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastFailure: ConnectorFailureCode | null;
  readonly importedDocuments: number;
}

export type ConnectorWorkspaceState = Readonly<Partial<Record<ConnectorId, ConnectorObservation>>>;

export interface ConnectorStatus extends ConnectorDescriptor, ConnectorObservation {
  readonly state: ConnectorRunState;
}

export type ConnectorPutResult = 'stored' | 'unchanged' | 'stale';

export interface ConnectorStore {
  get(workspace: string): Promise<ConnectorWorkspaceState>;
  /**
   * Mutates one connector only. `stale` means canonical attempt chronology
   * refused the observation; it does not promise cross-instance CAS.
   */
  put(workspace: string, id: ConnectorId, next: ConnectorObservation): Promise<ConnectorPutResult>;
}
