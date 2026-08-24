/**
 * Whether an agent workspace reads through the deployment's configured
 * base Hydra collection instead of opening a private collection.
 *
 * `public` is a logical product workspace name. The deployed base client
 * is already scoped to the real public collection (`backend` today), so
 * calling `withCollection('public')` silently opens a different empty
 * collection. `null` remains the compatibility spelling for the same
 * base source; opaque private workspace handles stay tenant-scoped.
 */
export function usesBaseAgentCollection(workspace: string | null): workspace is null | 'public' {
  return workspace === null || workspace === 'public';
}
