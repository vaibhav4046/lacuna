/**
 * Small product contracts shared by route components.
 *
 * These values are kept outside React so the endpoint and navigation choices
 * can be tested directly. The MCP names are not repeated here: the server's
 * live tools/list response remains the source of truth.
 */

import type {
  ConnectorCatalogue,
  ConnectorOutcome,
  ConnectorRefusalCode,
  ConnectorRunReceipt,
  FilePreviewResponse,
  WebhookIssueResponse,
  WebhookRevokeResponse,
  WebhookState,
} from '../api/connectors';

export const PUBLIC_WORKSPACE_PATH = '/explore/dash' as const;

const CONNECTOR_HASHES = new Set(['#file', '#github', '#https-api', '#webhook']);

const CONNECTOR_TARGETS = new Map([
  ['#file', 'file'], ['#github', 'github'], ['#https-api', 'https-api'], ['#webhook', 'webhook'],
] as const);

/** Hash-safe legacy aliases; unknown fragments never become selector or state input. */
export function connectorAliasTarget(path: string, hash: string): string | null {
  const base = path === '/app/connectors' ? '/app/conn'
    : path === '/explore/connectors' ? '/explore/conn' : null;
  if (base === null) return null;
  return `${base}${CONNECTOR_HASHES.has(hash) ? hash : ''}`;
}

/** Closed hash-to-DOM mapping used by both direct routes and legacy aliases. */
export function connectorAnchorTarget(hash: string): 'file' | 'github' | 'https-api' | 'webhook' | null {
  return CONNECTOR_TARGETS.get(hash as '#file') ?? null;
}

export const REVIEWED_OBSERVATION_COPY = Object.freeze({
  importedDocuments: 'RECORDED ACCEPTED DOCUMENTS',
  lastSuccessAt: 'LAST RECORDED ACCEPTANCE',
  lastFailure: 'LAST RECORDED FAILURE',
  mayLag: 'Recorded observations may lag when a concurrent or stale update wins, or observation persistence fails.',
});

export class FileWorkflow {
  #selected: File | null = null;
  #previewing: File | null = null;
  #review: { readonly file: File; readonly preview: FilePreviewResponse } | null = null;
  #importing = false;

  get selected(): File | null { return this.#selected; }
  get review(): { readonly file: File; readonly preview: FilePreviewResponse } | null { return this.#review; }

  select(file: File | null): void {
    this.#selected = file;
    this.#previewing = null;
    this.#review = null;
    this.#importing = false;
  }

  beginPreview(): File | null {
    if (this.#selected === null || this.#previewing !== null || this.#importing) return null;
    this.#previewing = this.#selected;
    this.#review = null;
    return this.#selected;
  }

  finishPreview(file: File, result: ConnectorOutcome<FilePreviewResponse>): void {
    if (this.#previewing !== file || this.#selected !== file) return;
    this.#previewing = null;
    this.#review = result.kind === 'receipt' ? { file, preview: result.value } : null;
  }

  beginImport(): { readonly file: File; readonly previewToken: string } | null {
    if (this.#review === null || this.#importing || this.#selected !== this.#review.file) return null;
    const request = { file: this.#review.file, previewToken: this.#review.preview.previewToken };
    this.#review = null;
    this.#importing = true;
    return request;
  }

  finishImport(): void { this.#importing = false; }
  reset(): void { this.select(null); }
}

export function canonicalGitHubReview(value: string): string | null {
  const held = value.trim();
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/u.exec(held);
  if (match === null) return null;
  const owner = match[1] ?? '';
  const repository = match[2] ?? '';
  const ownerValid = /^(?!-)(?!.*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/u.test(owner);
  const repositoryValid = /^[a-z0-9_.-]{1,100}$/u.test(repository)
    && repository !== '.' && repository !== '..' && !repository.endsWith('.git');
  return ownerValid && repositoryValid ? held : null;
}

export interface SafeHttpsReview {
  readonly submitted: string;
  readonly displayed: string;
  readonly queryPresent: boolean;
}

export function safeHttpsReview(value: string): SafeHttpsReview | null {
  const held = value.trim();
  if (held.length < 1 || held.length > 2_048) return null;
  try {
    const url = new URL(held);
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') return null;
    return {
      submitted: held,
      displayed: `${url.origin}${url.pathname}`,
      queryPresent: url.search !== '',
    };
  } catch {
    return null;
  }
}

export class ReviewedUrlWorkflow {
  #input = '';
  #reviewed: string | null = null;
  #pending = false;
  readonly #validate: (value: string) => string | null;

  constructor(validate: (value: string) => string | null) { this.#validate = validate; }
  edit(value: string): void { this.#input = value; this.#reviewed = null; this.#pending = false; }
  review(): boolean { this.#reviewed = this.#validate(this.#input); return this.#reviewed !== null; }
  confirm(): string | null {
    if (this.#reviewed === null || this.#pending) return null;
    const held = this.#reviewed;
    this.#reviewed = null;
    this.#pending = true;
    return held;
  }
  settle(): void { this.#pending = false; }
  reset(): void { this.edit(''); }
}

interface WebhookArbiterOptions {
  readonly issue: () => Promise<ConnectorOutcome<WebhookIssueResponse>>;
  readonly read: () => Promise<ConnectorOutcome<WebhookState>>;
  readonly revoke: (id: string) => Promise<ConnectorOutcome<WebhookRevokeResponse>>;
  readonly onReveal: (issued: Extract<WebhookIssueResponse, { readonly created: true }>) => void;
  readonly onState: (state: WebhookState | null) => void;
}

function issueAgrees(issued: Extract<WebhookIssueResponse, { readonly created: true }>, state: WebhookState): boolean {
  return state.configured && state.endpointId === issued.endpointId
    && state.endpoint === issued.endpoint && state.configuredAt === issued.configuredAt;
}

export interface WebhookRevokeConfirmation {
  readonly endpointId: string;
  readonly generation: number;
}

export type WebhookMutationResult =
  | 'revealed' | 'configured' | 'ready' | 'indeterminate' | 'discarded'
  | { readonly kind: 'known_refusal'; readonly status: number; readonly code: Extract<ConnectorOutcome<unknown>, { readonly kind: 'known_refusal' }>['code']; readonly reconciled: boolean };

export class WebhookLifecycleArbiter {
  #generation = 0;
  #state: WebhookState | null = null;
  readonly #options: WebhookArbiterOptions;

  constructor(options: WebhookArbiterOptions) { this.#options = options; }

  #clearAuthority(): void {
    this.#state = null;
    this.#options.onState(null);
  }

  async refresh(): Promise<'ready' | 'indeterminate' | 'discarded'> {
    const generation = ++this.#generation;
    this.#clearAuthority();
    const result = await this.#options.read();
    if (generation !== this.#generation || result.kind === 'discarded') return 'discarded';
    if (result.kind !== 'receipt') return 'indeterminate';
    this.#state = result.value;
    this.#options.onState(result.value);
    return 'ready';
  }

  adopt(state: WebhookState): void {
    this.#generation += 1;
    this.#state = state;
    this.#options.onState(state);
  }

  async issue(): Promise<WebhookMutationResult> {
    const generation = ++this.#generation;
    this.#clearAuthority();
    const issuedResult = await this.#options.issue();
    if (generation !== this.#generation || issuedResult.kind === 'discarded') return 'discarded';
    const refusal = issuedResult.kind === 'known_refusal' ? issuedResult : null;
    let provisional: Extract<WebhookIssueResponse, { readonly created: true }> | null =
      issuedResult.kind === 'receipt' && issuedResult.value.created ? issuedResult.value : null;
    const stateResult = await this.#options.read();
    if (generation !== this.#generation || stateResult.kind === 'discarded') {
      provisional = null;
      return 'discarded';
    }
    if (stateResult.kind !== 'receipt') {
      provisional = null;
      return refusal === null ? 'indeterminate' : { ...refusal, reconciled: false };
    }
    this.#state = stateResult.value;
    this.#options.onState(stateResult.value);
    if (refusal !== null) return { ...refusal, reconciled: true };
    if (provisional !== null && issueAgrees(provisional, stateResult.value)) {
      this.#options.onReveal(provisional);
      provisional = null;
      return 'revealed';
    }
    provisional = null;
    return stateResult.value.configured ? 'configured' : 'indeterminate';
  }

  captureRevoke(): WebhookRevokeConfirmation | null {
    return this.#state?.configured === true
      ? { endpointId: this.#state.endpointId, generation: this.#generation }
      : null;
  }

  async revoke(expected: WebhookRevokeConfirmation | null): Promise<WebhookMutationResult> {
    const captured = this.#state;
    if (expected === null || captured?.configured !== true
      || expected.generation !== this.#generation || expected.endpointId !== captured.endpointId) {
      return 'indeterminate';
    }
    const generation = ++this.#generation;
    this.#clearAuthority();
    const mutationResult = await this.#options.revoke(captured.endpointId);
    if (generation !== this.#generation) return 'discarded';
    const stateResult = await this.#options.read();
    if (generation !== this.#generation || stateResult.kind === 'discarded') return 'discarded';
    if (stateResult.kind !== 'receipt') {
      return mutationResult.kind === 'known_refusal'
        ? { ...mutationResult, reconciled: false }
        : 'indeterminate';
    }
    this.#state = stateResult.value;
    this.#options.onState(stateResult.value);
    if (mutationResult.kind === 'known_refusal') return { ...mutationResult, reconciled: true };
    return 'ready';
  }

  dispose(): void { this.#generation += 1; this.#state = null; }
}

export type ReceiptReadiness = 'confirmed' | 'not confirmed' | 'not applicable'
  | 'submission indeterminate; not confirmed';

export function receiptReadiness(receipt: ConnectorRunReceipt): ReceiptReadiness {
  if (receipt.indeterminateSubmission) return 'submission indeterminate; not confirmed';
  if (receipt.acceptedDocuments === 0) return 'not applicable';
  return receipt.searchableDocuments === receipt.acceptedDocuments ? 'confirmed' : 'not confirmed';
}

/** Stable, redacted product copy for the closed connector outcome union. */
export function connectorOutcomeMessage(result: ConnectorOutcome<unknown>): string | null {
  if (result.kind === 'receipt' || result.kind === 'discarded') return null;
  if (result.kind === 'indeterminate') return 'The response was lost or invalid. Do not retry automatically; check Memory first.';
  const messages: Readonly<Record<ConnectorRefusalCode, string>> = {
    validation_failed: 'Review the source fields and confirm one valid import again.',
    transport_failed: 'The import result is uncertain. Check Memory before deciding whether to try again.',
    parse_failed: 'The source could not be parsed safely. Correct its format, then review it again.',
    receipt_refused: 'Hydra refused one or more records. Review the exact receipt before trying a corrected source.',
    readiness_failed: 'Hydra accepted data, but search readiness was not confirmed. Check Memory.',
    readiness_timeout: 'Hydra accepted data, but search readiness timed out. Check Memory.',
    signing_not_configured: 'Signed webhooks are unavailable on this deployment. Ask an operator to configure signing.',
    session: 'Sign in again before starting another connector operation.',
    voice_binding: 'The exact session changed. Reload this private page before continuing.',
    permission: 'Use this same-origin app page with an account authorized for the workspace.',
    csrf: 'Refresh this page to obtain a current security token before trying again.',
    body: 'Submit only the supported form from this page, then review it again.',
    workspace_ingest_budget: 'This workspace reached its import limit. Wait for the stated window or ask an operator.',
    workspace_file_budget: 'This workspace reached its file import limit. Wait before previewing another file.',
    file_import_unavailable: 'File import is unavailable on this deployment. Ask an operator to enable it.',
    invalid_multipart: 'Choose one file again; the upload form was not accepted.',
    request_too_large: 'Choose a smaller request before previewing again.',
    file_too_large: 'Choose one file smaller than 8 MiB.',
    file_required: 'Choose one exact file before previewing.',
    invalid_filename: 'Rename the file to a simple supported filename, then choose it again.',
    unsupported_file: 'Choose a .txt, .md, .pdf, or .docx file.',
    invalid_file: 'The selected file failed structural validation. Choose a valid supported file.',
    invalid_utf8: 'Save the text file as UTF-8, then preview it again.',
    empty_file: 'Choose a non-empty file with importable text.',
    file_too_complex: 'Choose a simpler file within the parser limits.',
    document_too_long: 'Shorten or split the document before previewing again.',
    preview_invalid: 'That preview is no longer usable. Preview the exact file again.',
    preview_expired: 'That preview expired. Preview the exact file again before importing.',
    preview_replayed: 'That preview was already consumed. Check Memory before previewing again.',
    file_import_failed: 'The file import did not complete. Check Memory, then preview the exact file again if needed.',
    invalid_repository_url: 'Enter one canonical public GitHub repository root.',
    invalid_github_request: 'Review one canonical public GitHub repository root before importing.',
    github_unavailable: 'GitHub did not answer safely. Wait, then review the repository again.',
    github_timeout: 'GitHub did not answer within the bounded deadline. Wait before trying again.',
    github_snapshot_invalid: 'The resolved repository snapshot was invalid. Choose a different public repository.',
    github_integrity_failed: 'Repository content failed integrity validation. Do not import this snapshot.',
    github_budget_exceeded: 'The repository exceeds the bounded import limits. Choose a smaller repository.',
    github_no_documents: 'No supported public text files remained after safe filtering. Choose a repository with supported files.',
    github_import_failed: 'The repository import did not complete. Check Memory before reviewing it again.',
    invalid_https_url: 'Enter one public HTTPS URL without credentials or a fragment.',
    invalid_https_request: 'Review one valid public HTTPS URL before importing.',
    https_busy: 'The bounded HTTPS reader is busy. Wait before submitting another reviewed source.',
    https_timeout: 'The public source did not answer within the bounded deadline. Wait before trying again.',
    https_dns_failed: 'The public hostname could not be validated. Choose a different public HTTPS source.',
    https_address_blocked: 'That address is not eligible for public import. Choose a different public HTTPS source.',
    https_peer_mismatch: 'The HTTPS peer did not match its validated public address. Choose a different source.',
    https_redirect_refused: 'Redirects are not followed. Review the final canonical public HTTPS URL directly.',
    https_upstream_failed: 'The public source returned an unsupported response. Check the source before trying again.',
    https_tls_failed: 'The public source could not establish validated HTTPS. Choose a different source.',
    https_response_invalid: 'The public response framing was invalid. Choose a different source.',
    https_type_unsupported: 'Choose a source that returns JSON, plain text, or Markdown as UTF-8.',
    https_too_large: 'Choose a smaller public response within the import limit.',
    https_json_invalid: 'The source did not return valid bounded JSON. Correct the source or choose text.',
    https_content_invalid: 'The public response contained text that cannot be imported safely.',
    https_import_failed: 'The HTTPS import did not complete. Check Memory before reviewing it again.',
    connector_state_unavailable: 'Recorded connector state is unknown. Refresh recorded state before importing.',
    webhook_state_unavailable: 'Refresh webhook state before changing the endpoint.',
    webhook_lifecycle_failed: 'Check authoritative webhook state before another lifecycle action.',
    webhook_not_found: 'That endpoint is no longer active. Refresh webhook state.',
    invalid_webhook_request: 'Refresh webhook state and use only the current lifecycle controls.',
    github_import_unavailable: 'GitHub import is unavailable on this deployment.',
    https_import_unavailable: 'HTTPS import is unavailable on this deployment.',
  };
  return messages[result.code];
}

export interface ConnectorReceiptPresentation {
  readonly receipt: ConnectorRunReceipt;
  readonly reference: string | null;
}

export type ConnectorReceiptEvent =
  | { readonly type: 'dispatched'; readonly connector: 'file-preview' | 'file-import' | 'github' | 'https' }
  | { readonly type: 'received'; readonly receipt: ConnectorRunReceipt; readonly reference: string | null }
  | { readonly type: 'reset' };

/** New imports own the receipt plane immediately; a refusal cannot sit beside an older success. */
export function connectorReceiptPresentation(
  _current: ConnectorReceiptPresentation | null,
  event: ConnectorReceiptEvent,
): ConnectorReceiptPresentation | null {
  return event.type === 'received' ? { receipt: event.receipt, reference: event.reference } : null;
}

export interface ConnectorCataloguePresentation {
  readonly catalogue: ConnectorCatalogue | null;
  readonly state: 'loading' | 'ready' | 'unknown';
}

export type ConnectorCatalogueEvent =
  | { readonly type: 'started' }
  | { readonly type: 'received'; readonly catalogue: ConnectorCatalogue }
  | { readonly type: 'failed' }
  | { readonly type: 'reset' };

/** Background validation retains the last decoded object for stable DOM ownership, never as current truth. */
export function connectorCataloguePresentation(
  current: ConnectorCataloguePresentation,
  event: ConnectorCatalogueEvent,
): ConnectorCataloguePresentation {
  if (event.type === 'received') return { catalogue: event.catalogue, state: 'ready' };
  if (event.type === 'reset') return { catalogue: null, state: 'loading' };
  return { catalogue: current.catalogue, state: event.type === 'started' ? 'loading' : 'unknown' };
}

export interface ExactModalFocusTarget {
  readonly isConnected: boolean;
  readonly disabled?: boolean;
  focus(): void;
}

/** Restore the initiating control only while it is still mounted and keyboard-operable. */
export function restoreExactModalFocus(target: ExactModalFocusTarget | null): boolean {
  if (target === null || !target.isConnected || target.disabled === true) return false;
  target.focus();
  return true;
}

/** Commit away a revoke confirmation/result before returning to its stable trigger. */
export function commitAndRestoreWebhookTrigger(
  commit: () => void,
  flush: (commit: () => void) => void,
  target: ExactModalFocusTarget | null,
): boolean {
  flush(commit);
  return restoreExactModalFocus(target);
}

export function fileSelectionProblem(file: Pick<File, 'name' | 'size'> | null): string | null {
  if (file === null) return null;
  const supported = /\.(?:txt|md|pdf|docx)$/iu.test(file.name);
  return supported && file.size <= 8 * 1024 * 1024
    ? null
    : 'Choose one .txt, .md, .pdf, or .docx file smaller than 8 MiB.';
}

/** Commit removal of the VoiceDock before allowing the webhook secret dialog to exist. */
export function revealExclusiveSecret(
  closeDock: () => void,
  reveal: () => void,
  flush: (commit: () => void) => void,
): void {
  flush(closeDock);
  reveal();
}

/** Clipboard failures are an expected browser capability boundary, never a logging path. */
export async function copyConnectorSecret(
  value: string,
  writeText: ((value: string) => PromiseLike<void> | void) | undefined,
): Promise<boolean> {
  if (typeof writeText !== 'function') return false;
  try {
    await writeText(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commands exposed by the shipped CLI.
 *
 * The regression suite compares this browser-safe copy with src/cli/args.ts,
 * which remains the parser's source of truth.
 */
export const CLI_COMMAND_NAMES = [
  'doctor',
  'status',
  'profile',
  'shell',
  'ask',
  'read',
  'explain',
  'timeline',
  'bench',
] as const;

export function askEndpoint(demo: boolean): '/api/explore/ask' | '/api/ask' {
  return demo ? '/api/explore/ask' : '/api/ask';
}

export type VoiceDockKeyboardAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'collapse' }
  | { readonly kind: 'dialog' }
  | { readonly kind: 'focus'; readonly index: number };

/**
 * The dialog owns Escape and Tab only. Collapsing never implies cancelling a
 * pending operation; that authority remains behind the explicit CANCEL control.
 */
export function voiceDockKeyboardAction(
  key: string,
  shiftKey: boolean,
  activeIndex: number,
  focusableCount: number,
): VoiceDockKeyboardAction {
  if (key === 'Escape') return { kind: 'collapse' };
  if (key !== 'Tab') return { kind: 'none' };
  if (focusableCount < 1) return { kind: 'dialog' };
  const direction = shiftKey ? -1 : 1;
  const from = activeIndex >= 0 && activeIndex < focusableCount
    ? activeIndex
    : shiftKey ? 0 : -1;
  return {
    kind: 'focus',
    index: (from + direction + focusableCount) % focusableCount,
  };
}

export interface VoiceModalBackgroundRegion {
  inert: boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Contain a modal without assuming the shell owned the previous DOM state.
 * Cleanup is idempotent so a close followed by unmount cannot overwrite a
 * later owner's accessibility attributes.
 */
export function containVoiceModalBackground(
  regions: readonly VoiceModalBackgroundRegion[],
): () => void {
  const previous = regions.map((region) => ({
    region,
    inert: region.inert,
    ariaHidden: region.getAttribute('aria-hidden'),
  }));
  for (const { region } of previous) {
    region.inert = true;
    region.setAttribute('aria-hidden', 'true');
  }
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    for (const state of previous) {
      state.region.inert = state.inert;
      if (state.ariaHidden === null) state.region.removeAttribute('aria-hidden');
      else state.region.setAttribute('aria-hidden', state.ariaHidden);
    }
  };
}

const VOICE_DOCK_TEXT_LIMIT = 640;
const VOICE_DOCK_COUNT_LIMIT = 9_999;

/** Compact dock copy is bounded even if a malformed browser response is not. */
export function voiceDockText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = value.trim();
  if (text === '') return null;
  if (text.length <= VOICE_DOCK_TEXT_LIMIT) return text;
  return `${text.slice(0, VOICE_DOCK_TEXT_LIMIT - 1)}…`;
}

/** Counts stay exact up to the dock's visual limit and declare truncation above it. */
export function voiceDockCount(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0) return '0';
  return value > VOICE_DOCK_COUNT_LIMIT ? '9,999+' : value.toLocaleString('en-GB');
}

export const MCP_TOOLS_LIST_REQUEST = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
} as const;

/** Read ordered tool names from a tools/list reply and ignore malformed rows. */
export function mcpToolNames(reply: unknown): readonly string[] {
  if (typeof reply !== 'object' || reply === null) return [];
  const result = Reflect.get(reply, 'result');
  if (typeof result !== 'object' || result === null) return [];
  const tools = Reflect.get(result, 'tools');
  if (!Array.isArray(tools)) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (typeof tool !== 'object' || tool === null) continue;
    const name = Reflect.get(tool, 'name');
    if (typeof name !== 'string' || name.trim() === '' || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}
