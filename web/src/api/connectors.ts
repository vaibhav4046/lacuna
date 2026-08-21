export interface FilePreviewResponse {
  readonly filename: string;
  readonly title: string;
  readonly type: 'text' | 'markdown' | 'pdf' | 'docx';
  readonly excerpt: string;
  readonly characters: number;
  readonly pages: number;
  readonly paragraphs: number;
  readonly tables: number;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
  readonly previewToken: string;
  readonly expiresAt: string;
}

export interface FileImportResponse {
  readonly connectorId: 'text' | 'markdown' | 'pdf' | 'docx';
  readonly submittedDocuments: number;
  readonly duplicateDocuments: number;
  readonly acceptedDocuments: number;
  readonly searchableDocuments: number;
  readonly failedDocuments: number;
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly observationWrite: 'stored' | 'unchanged' | 'stale' | 'failed';
}

export type ConnectorFileResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number };

const FILE_REQUEST_TIMEOUT_MS = 30_000;

async function sendFile<T>(
  path: string,
  form: FormData,
  csrf: string,
  signal: AbortSignal,
): Promise<ConnectorFileResult<T>> {
  const control = new AbortController();
  let timedOut = false;
  const relay = () => control.abort();
  if (signal.aborted) control.abort();
  else signal.addEventListener('abort', relay, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    control.abort();
  }, FILE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: 'POST',
      signal: control.signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRF-Token': csrf },
      body: form,
    });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, value: await response.json() as T };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { ok: false, status: timedOut && aborted ? 408 : 0 };
  } finally {
    globalThis.clearTimeout(timeout);
    signal.removeEventListener('abort', relay);
  }
}

export function previewFile(
  file: File,
  csrf: string,
  signal: AbortSignal,
): Promise<ConnectorFileResult<FilePreviewResponse>> {
  const form = new FormData();
  form.set('file', file);
  return sendFile('/api/workspace/connectors/file/preview', form, csrf, signal);
}

export function importFile(
  file: File,
  previewToken: string,
  csrf: string,
  signal: AbortSignal,
): Promise<ConnectorFileResult<FileImportResponse>> {
  const form = new FormData();
  form.set('file', file);
  form.set('preview_token', previewToken);
  return sendFile('/api/workspace/connectors/file/import', form, csrf, signal);
}
