export class RetrievalError extends Error {
  override readonly name: string = 'RetrievalError';
}

/**
 * Raised when a row comes back in a shape the decoder was not promised. Every
 * read in this layer names its columns and states their types, so a row that
 * does not fit is a change in the graph or in the engine, not a case to guess
 * at. Guessing here would put an invented value in front of a citation, which
 * is the one thing this product exists not to do.
 */
export class RetrievalDecodeError extends RetrievalError {
  override readonly name: string = 'RetrievalDecodeError';
}

/**
 * Raised when the pure half and the fetching half disagree about which node the
 * question resolves through. They select it with the same function, so this can
 * only fire if a view was assembled by hand and assembled wrong.
 */
export class RetrievalConsistencyError extends RetrievalError {
  override readonly name: string = 'RetrievalConsistencyError';
}
