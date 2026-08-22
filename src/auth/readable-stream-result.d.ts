/**
 * Node's fetch/Web Streams types expose ReadableStreamDefaultReader in the
 * root TypeScript build, but that lib set does not declare the DOM-only
 * ReadableStreamReadResult alias. Keep the one result shape this boundary
 * consumes local to the build instead of enabling the entire DOM library.
 */
type ReadableStreamReadResult<T> =
  | { readonly done: false; readonly value: T }
  | { readonly done: true; readonly value?: undefined };
