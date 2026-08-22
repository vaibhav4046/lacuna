/**
 * Every failure this client produces is one of these, and none of them ever
 * carry the bearer token. Error messages get logged, and a token in a log line
 * is a leaked token.
 */
export class HydraError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Environment is missing or malformed. Thrown before any request is built. */
export class HydraConfigError extends HydraError {}

/**
 * The client refused to send the request. This is Lacuna's own guard tripping,
 * not HydraDB's, and it means the request never reached the network.
 */
export class HydraGuardError extends HydraError {}

/**
 * The request left the process and something below the application layer went
 * wrong: connection refused, aborted, timed out, or a response that exceeded a
 * size cap.
 */
export class HydraTransportError extends HydraError {}

/** A submitted ingest may have landed, but no complete exact receipt survived. */
export class HydraIngestIndeterminateError extends HydraError {
  constructor() {
    super('HydraDB ingest receipt is indeterminate');
  }
}

/** HydraDB answered, and answered with a non-2xx status. */
export class HydraQueryError extends HydraError {
  readonly status: number;
  /** The engine's own words, unwrapped from the JSON envelope it arrives in. */
  readonly engineMessage: string;

  constructor(status: number, engineMessage: string, options?: ErrorOptions) {
    super(`HydraDB returned ${status}: ${engineMessage}`, options);
    this.status = status;
    this.engineMessage = engineMessage;
  }
}

/** The response was a 2xx that did not match the documented wire shape. */
export class HydraDecodeError extends HydraError {}
