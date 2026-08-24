import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';

import {
  getConnectorCatalogue,
  getWebhookState,
  importFile,
  importGitHub,
  importSlack,
  importWork,
  type WorkImportRequest,
  type WorkSourceId,
  importGitLab,
  importHttps,
  issueWebhook,
  previewFile,
  revokeWebhook,
  type ConnectorCatalogue,
  type ConnectorMutationContext,
  type ConnectorRunReceipt,
  type ConnectorStatus,
  type FilePreviewResponse,
  type WebhookIssueResponse,
  type WebhookState,
} from '../../api/connectors';
import { csrfHeaders } from '../../api/client';
import { useSession } from '../../api/session';
import { useScope } from '../../api/scope';
import { CONNECTOR_PRESENTATION, dotFor } from '../../design/connectors';
import { useVoiceAssistant } from '../../voice/assistant-context';
import {
  REVIEWED_OBSERVATION_COPY,
  WebhookLifecycleArbiter,
  canonicalGitHubReview,
  canonicalGitLabReview,
  connectorAnchorTarget,
  connectorCataloguePresentation,
  connectorOutcomeMessage as outcomeMessage,
  connectorReceiptPresentation,
  commitAndRestoreWebhookTrigger,
  containVoiceModalBackground,
  copyConnectorSecret,
  fileSelectionProblem,
  receiptReadiness,
  restoreExactModalFocus,
  revealExclusiveSecret,
  safeHttpsReview,
  type SafeHttpsReview,
  type WebhookRevokeConfirmation,
} from '../product-contracts';

function currentCsrf(): string {
  try { return csrfHeaders()['X-CSRF-Token'] ?? ''; } catch { return ''; }
}

export function ReceiptSummary({ receipt, reference }: { receipt: ConnectorRunReceipt; reference: string | null }) {
  const fullySearchable = receipt.acceptedDocuments > 0
    && receipt.searchableDocuments === receipt.acceptedDocuments;
  const readinessPending = receipt.acceptedDocuments > 0
    && receipt.searchableDocuments < receipt.acceptedDocuments
    && (receipt.failure === 'readiness_failed' || receipt.failure === 'readiness_timeout');
  return (
    <>
      <span className="connector-kicker">EXACT OPERATION RECEIPT</span>
      <span>{receipt.connectorId.toUpperCase()} · {receipt.startedAt}</span>
      <strong>{receipt.indeterminateSubmission ? 'Submission outcome indeterminate' : fullySearchable ? 'Accepted and searchable' : receipt.acceptedDocuments > 0 ? 'Accepted; search readiness incomplete' : receipt.duplicateDocuments > 0 ? 'Already present' : receipt.emptyDocuments > 0 && receipt.failedDocuments === 0 ? 'Read; no claim stated' : 'No accepted document'}</strong>
      <dl className="connector-counts">
        <div><dt>ACCEPTED</dt><dd>{receipt.acceptedDocuments}</dd></div>
        <div><dt>SEARCHABLE</dt><dd>{receipt.searchableDocuments}</dd></div>
        <div><dt>DUPLICATE</dt><dd>{receipt.duplicateDocuments}</dd></div>
        <div><dt>NO CLAIM</dt><dd>{receipt.emptyDocuments}</dd></div>
        <div><dt>FAILED</dt><dd>{receipt.failedDocuments}</dd></div>
      </dl>
      <p>Readiness: {receiptReadiness(receipt)} · failure detail: {receipt.failure ?? 'none'} · observation: {receipt.observationWrite}</p>
      {readinessPending ? <p>Accepted documents are stored. Search indexing has not been confirmed yet; refresh Memory before retrying.</p> : null}
      {/*
        A source that stated nothing is a result, not a breakage.

        It was counted as a failed document and reported as parse_failed, so a
        licence file or a page of install commands came back looking like a
        broken import. The extractor reads eleven sentence shapes and records
        only what it can justify; a document holding none of them was read
        correctly and had nothing in it. Saying so is the same discipline the
        answer path already applies when it abstains.
      */}
      {receipt.emptyDocuments === 0 ? null : <p>{receipt.emptyDocuments} {receipt.emptyDocuments === 1 ? 'document was read and stated nothing' : 'documents were read and stated nothing'} this memory can record. Nothing failed: the extractor reads a fixed set of sentence shapes, and prose outside them produces no claim rather than a guess.</p>}
      {receipt.failedDocuments === 0 ? null : <p>{receipt.failedDocuments} submitted {receipt.failedDocuments === 1 ? 'document failed' : 'documents failed'}{receipt.searchableDocuments > 0 ? ' separately from the searchable acceptance.' : '.'}</p>}
      {reference === null ? null : <p>SAFE REFERENCE · <code>{reference}</code></p>}
    </>
  );
}

function Receipt({ receipt, reference }: { receipt: ConnectorRunReceipt; reference: string | null }) {
  const navigate = useNavigate();
  const region = useRef<HTMLElement>(null);
  useEffect(() => { region.current?.focus(); }, []);
  return (
    <section ref={region} className="connector-receipt" aria-label="Exact operation receipt" tabIndex={-1}>
      <ReceiptSummary receipt={receipt} reference={reference} />
      <div className="connector-actions">
        <button type="button" onClick={() => navigate('/app/ask')}>ASK THIS MEMORY</button>
        <button type="button" onClick={() => navigate('/app/memory')}>VIEW MEMORY</button>
      </div>
    </section>
  );
}

type CatalogueState = 'loading' | 'ready' | 'unknown';

export function ConnectorAvailabilityNotice({ catalogueState, connector, unavailableCopy }: {
  readonly catalogueState: CatalogueState;
  readonly connector: ConnectorStatus | null;
  readonly unavailableCopy: string;
}) {
  if (connector === null) return <p role="status">{catalogueState === 'loading' ? 'CHECKING deployment availability…' : 'Deployment availability is UNKNOWN. Refresh recorded state before importing.'}</p>;
  if (connector.availability === 'unavailable') return <p role="status">{unavailableCopy}</p>;
  return null;
}

export function Observation({ catalogue, catalogueState }: {
  readonly catalogue: ConnectorCatalogue | null;
  readonly catalogueState: CatalogueState;
}) {
  if (catalogue === null || catalogueState !== 'ready') return <p role="status">{catalogueState === 'loading' ? 'CHECKING recorded observations…' : 'Recorded observations are UNKNOWN. Refresh recorded state.'}</p>;
  return (
    <section className="connector-observations" aria-labelledby="connector-observation-heading">
      <div>
        <span className="connector-kicker">RECORDED OBSERVATION</span>
        <h2 id="connector-observation-heading">Workspace import records</h2>
        <p>{REVIEWED_OBSERVATION_COPY.mayLag}</p>
      </div>
      <div className="connector-observation-grid">
        {catalogue.connectors.map((connector) => {
          // A prior run can have durable accepted documents while its bounded
          // indexing read timed out. That is not a failed import: the records
          // exist, and search readiness is the only unconfirmed part. Keep the
          // historical failure detail visible, but do not label the connector
          // FAILED in a way that contradicts the accepted count.
          const readinessPending = connector.availability === 'available'
            && connector.importedDocuments > 0
            && (connector.lastFailure === 'readiness_failed' || connector.lastFailure === 'readiness_timeout');
          const state = connector.availability === 'available'
            ? readinessPending ? 'syncing' : connector.state
            : 'unavailable';
          return (
          <article key={connector.id}>
            <span className="connector-status"><i style={{ background: dotFor(state) }} />{connector.availability === 'available' ? state.toUpperCase() : 'UNAVAILABLE'}</span>
            <h3>{connector.label}</h3>
            <dl>
              <div><dt>{REVIEWED_OBSERVATION_COPY.importedDocuments}</dt><dd>{connector.importedDocuments}</dd></div>
              <div><dt>{REVIEWED_OBSERVATION_COPY.lastSuccessAt}</dt><dd>{connector.lastSuccessAt === null ? '—' : new Date(connector.lastSuccessAt).toLocaleString()}</dd></div>
              <div><dt>{REVIEWED_OBSERVATION_COPY.lastFailure}</dt><dd>{connector.lastFailure ?? '—'}</dd></div>
            </dl>
            {readinessPending ? <p>Accepted documents are stored; search indexing has not been confirmed.</p>
              : connector.reason === null ? null : <p>Required server support is not configured.</p>}
          </article>
          );
        })}
      </div>
    </section>
  );
}

export function FileReplayCopy() {
  return <p id="file-instructions">Choose one exact file under 8 MiB. Preview does not write. Confirm reuploads the same in-memory File and preview token. The token has process-local replay protection that may reset on a cold instance.</p>;
}

/** Clear the browser-owned FileList/value so choosing the same file can emit change again. */
export function resetNativeFileSelection(input: HTMLInputElement | null): void {
  if (input !== null) input.value = '';
}

export function FileSourceField({ problem, disabled, inputRef, onSelect }: {
  readonly problem: string | null;
  readonly disabled: boolean;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly onSelect: (file: File | null) => void;
}) {
  return (
    <>
      <FileReplayCopy />
      <label htmlFor="connector-file">SOURCE FILE</label>
      <input
        id="connector-file"
        aria-describedby={`file-instructions${problem === null ? '' : ' connector-file-error'}`}
        aria-invalid={problem === null ? undefined : true}
        type="file"
        ref={inputRef}
        disabled={disabled}
        accept=".txt,.md,.json,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        onChange={(event) => onSelect(event.currentTarget.files?.[0] ?? null)}
      />
      {problem === null ? null : <p id="connector-file-error" role="alert" tabIndex={-1}>{problem}</p>}
    </>
  );
}

export function ConnectorUrlField({
  id, instructionsId, errorId, label, name, value, placeholder, problem, disabled, onChange,
}: {
  readonly id: string;
  readonly instructionsId: string;
  readonly errorId: string;
  readonly label: string;
  readonly name: string;
  readonly value: string;
  readonly placeholder: string;
  readonly problem: string | null;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-describedby={`${instructionsId}${problem === null ? '' : ` ${errorId}`}`}
        aria-invalid={problem === null ? undefined : true}
        type="url"
        name={name}
        autoComplete="off"
        spellCheck={false}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {problem === null ? null : <p id={errorId} role="alert" tabIndex={-1}>{problem}</p>}
    </>
  );
}

export function WebhookLifecycleControl({
  connector, catalogueState = 'ready', webhook, pending, needsRefresh, confirmRevoke,
  triggerRef, problem = null, onSetup, onRequestRevoke, onConfirmRevoke, onCancelRevoke, onRefresh,
}: {
  readonly connector: ConnectorStatus | null;
  readonly catalogueState?: CatalogueState;
  readonly webhook: WebhookState | null;
  readonly pending: string | null;
  readonly needsRefresh: boolean;
  readonly confirmRevoke: WebhookRevokeConfirmation | null;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly problem?: string | null;
  readonly onSetup: () => void;
  readonly onRequestRevoke: () => void;
  readonly onConfirmRevoke: () => void;
  readonly onCancelRevoke: () => void;
  readonly onRefresh: () => void;
}) {
  const availabilityReady = catalogueState === 'ready';
  const available = availabilityReady && connector?.availability === 'available';
  const webhookPending = pending === 'webhook' || pending === 'webhook-revoke' || pending === 'webhook-state';
  const retainedTrigger = connector?.availability === 'available'
    && (webhook !== null || webhookPending || needsRefresh);
  const triggerGuarded = !availabilityReady || pending !== null || needsRefresh;
  const confirmationMatches = confirmRevoke !== null && webhook?.configured === true
    && confirmRevoke.endpointId === webhook.endpointId;
  return (
    <>
      {availabilityReady ? <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={connector} unavailableCopy="Signed webhooks are unavailable on this deployment." />
        : <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={null} unavailableCopy="Signed webhooks are unavailable on this deployment." />}
      {!available ? null : webhook === null ? (
        <>
          <p role="status">{needsRefresh ? 'Authoritative webhook state is unverified.' : pending === 'webhook' ? 'Verifying authoritative webhook state…' : 'Checking authoritative webhook state…'}</p>
          {needsRefresh ? <button type="button" disabled={pending !== null} onClick={onRefresh}>REFRESH WEBHOOK STATE</button> : null}
        </>
      ) : webhook.configured ? (
        <div className="connector-review"><strong>CONNECTED</strong><p>Endpoint configured {new Date(webhook.configuredAt).toLocaleString()}. Signing secret unavailable.</p><code>{webhook.endpoint}</code></div>
      ) : <p>No endpoint is configured for this workspace.</p>}
      {(available && retainedTrigger) || (!availabilityReady && retainedTrigger) ? (
        <button
          ref={triggerRef}
          data-webhook-lifecycle-trigger="1"
          className={webhook?.configured === true ? 'connector-danger' : 'connector-primary'}
          type="button"
          aria-disabled={triggerGuarded ? true : undefined}
          onClick={() => {
            if (triggerGuarded) return;
            if (webhook?.configured === true) onRequestRevoke();
            else onSetup();
          }}
        >
          {pending === 'webhook-revoke' ? 'REVOKING…'
            : pending === 'webhook' || pending === 'webhook-state' ? 'VERIFYING…'
              : needsRefresh ? 'WEBHOOK STATE UNVERIFIED'
                : webhook?.configured === true ? 'REVOKE WEBHOOK' : 'ISSUE ENDPOINT + SECRET'}
        </button>
      ) : null}
      {available && confirmationMatches ? (
        <div className="connector-confirm" role="group" aria-labelledby="revoke-heading">
          <h3 id="revoke-heading">Revoke this endpoint?</h3>
          <p>Future deliveries will be refused. Existing audit and imported data are retained.</p>
          <button className="connector-danger" type="button" onClick={onConfirmRevoke}>CONFIRM REVOCATION</button>
          <button type="button" onClick={onCancelRevoke}>KEEP ENDPOINT</button>
        </div>
      ) : null}
      {problem === null ? null : <p id="connector-webhook-error" role="alert" tabIndex={-1}>{problem}</p>}
    </>
  );
}

export function WebhookSecretDialog({ issued, acknowledge, copy, copyState, dialogRef, onKeyDown }: {
  readonly issued: Extract<WebhookIssueResponse, { readonly created: true }>;
  readonly acknowledge: () => void;
  readonly copy: (value: string, label: string) => void;
  readonly copyState: string;
  readonly dialogRef?: RefObject<HTMLDivElement | null>;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}) {
  return (
    <div ref={dialogRef} className="connector-modal" role="dialog" aria-modal="true" aria-labelledby="webhook-secret-title" tabIndex={-1} onKeyDown={onKeyDown}>
      <span className="connector-kicker">ONE-TIME SIGNING SECRET</span>
      <h2 id="webhook-secret-title">Save this webhook secret now.</h2>
      <p>It will not be shown again. Lacuna reveals it only after authoritative endpoint readback agrees.</p>
      <div><span>ENDPOINT</span><code>{issued.endpoint}</code><button type="button" onClick={() => copy(issued.endpoint, 'Endpoint')}>COPY ENDPOINT</button></div>
      <div><span>SIGNING SECRET</span><code>{issued.secret}</code><button type="button" onClick={() => copy(issued.secret, 'Secret')}>COPY SECRET</button></div>
      <p className="connector-copy-status" aria-live="polite">{copyState}</p>
      <button className="connector-primary" type="button" onClick={acknowledge}>I SAVED THE SECRET</button>
    </div>
  );
}

function SecretModal({ issued, acknowledge, returnTarget }: {
  readonly issued: Extract<WebhookIssueResponse, { readonly created: true }>;
  readonly acknowledge: () => void;
  readonly returnTarget: RefObject<HTMLButtonElement | null>;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const fallbackFocus = useRef<HTMLElement | null>(null);
  const [copyState, setCopyState] = useState('');
  useEffect(() => {
    fallbackFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const regions = Array.from(document.querySelectorAll<HTMLElement>('[data-shellnav],[data-shellmain],[data-voice-launcher],[data-voice-modal-backdrop],[data-voice-dialog]'));
    const restore = containVoiceModalBackground(regions);
    dialog.current?.focus();
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      restore();
      if (!restoreExactModalFocus(returnTarget.current)) fallbackFocus.current?.focus();
    };
  }, [returnTarget]);

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
    if (focusable.length === 0) { event.preventDefault(); dialog.current?.focus(); return; }
    const active = focusable.indexOf(document.activeElement as HTMLElement);
    const index = active >= 0 ? active : event.shiftKey ? 0 : -1;
    const next = (index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  }

  function copy(value: string, label: string) {
    let writer: ((held: string) => PromiseLike<void> | void) | undefined;
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText === 'function') writer = clipboard.writeText.bind(clipboard);
    } catch {
      writer = undefined;
    }
    void copyConnectorSecret(value, writer).then((copied) => {
      setCopyState(copied ? `${label} copied.` : 'Copy was blocked. Select the value manually.');
    });
  }

  return createPortal(
    <div className="connector-modal-backdrop">
      <WebhookSecretDialog issued={issued} acknowledge={acknowledge} copy={copy} copyState={copyState} dialogRef={dialog} onKeyDown={key} />
    </div>, document.body,
  );
}

export function PrivateConnectors() {
  const { loaded } = useSession();
  const { closeDock } = useVoiceAssistant();
  const session = loaded.state === 'ready' && loaded.value.signedIn ? loaded.value.session : null;
  const [cataloguePresentationState, dispatchCatalogue] = useReducer(connectorCataloguePresentation, {
    catalogue: null,
    state: 'loading',
  });
  const { catalogue, state: catalogueState } = cataloguePresentationState;
  const [webhook, setWebhook] = useState<WebhookState | null>(null);
  const [webhookNeedsRefresh, setWebhookNeedsRefresh] = useState(false);
  const [secret, setSecret] = useState<Extract<WebhookIssueResponse, { readonly created: true }> | null>(null);
  const [problem, setProblem] = useState<{ readonly source: 'catalogue' | 'file' | 'github' | 'gitlab' | 'https' | 'webhook' | 'slack' | 'work'; readonly message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // React's disabled prop is only visible after a render. Keep the lock in a
  // ref as well so two rapid clicks cannot dispatch duplicate imports or
  // webhook lifecycle mutations in the same event turn.
  const pendingRef = useRef<string | null>(null);
  const [receiptPresentation, dispatchReceipt] = useReducer(connectorReceiptPresentation, null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<FilePreviewResponse | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [slackChannel, setSlackChannel] = useState('');
  const [slackToken, setSlackToken] = useState('');
  const [slackReview, setSlackReview] = useState<string | null>(null);
  const [workSource, setWorkSource] = useState<WorkSourceId>('notion');
  const [workRef, setWorkRef] = useState('');
  const [workSite, setWorkSite] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [workToken, setWorkToken] = useState('');
  const [workReview, setWorkReview] = useState<WorkImportRequest | null>(null);
  const [githubUrl, setGithubUrl] = useState('');
  const [githubReview, setGithubReview] = useState<string | null>(null);
  const [gitlabUrl, setGitlabUrl] = useState('');
  const [gitlabReview, setGitlabReview] = useState<string | null>(null);
  const [httpsUrl, setHttpsUrl] = useState('');
  const [httpsReview, setHttpsReview] = useState<SafeHttpsReview | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<WebhookRevokeConfirmation | null>(null);
  const webhookTrigger = useRef<HTMLButtonElement>(null);
  const catalogueGeneration = useRef(0);
  const fileGeneration = useRef(0);
  const closeDockRef = useRef(closeDock);
  closeDockRef.current = closeDock;
  const binding = session?.binding ?? null;
  const workspace = session?.workspace ?? null;
  const [control, setControl] = useState<AbortController | null>(null);

  function beginPending(value: string): boolean {
    if (pendingRef.current !== null) return false;
    pendingRef.current = value;
    setPending(value);
    return true;
  }

  function finishPending(): void {
    pendingRef.current = null;
    setPending(null);
  }

  useEffect(() => {
    const next = new AbortController();
    setControl(next);
    return () => next.abort();
  }, [binding, workspace]);

  const context: ConnectorMutationContext | null = useMemo(() => binding === null || control === null ? null : ({
    binding,
    csrf: currentCsrf(),
    signal: control.signal,
  }), [binding, control]);

  const refreshCatalogue = useCallback(async () => {
    if (binding === null || control === null) return;
    const generation = ++catalogueGeneration.current;
    dispatchCatalogue({ type: 'started' });
    const result = await getConnectorCatalogue(binding, control.signal);
    if (generation !== catalogueGeneration.current || control.signal.aborted) return;
    if (result.kind === 'receipt') {
      dispatchCatalogue({ type: 'received', catalogue: result.value });
      setProblem((held) => held?.source === 'catalogue' ? null : held);
    } else if (result.kind !== 'discarded') {
      dispatchCatalogue({ type: 'failed' });
      setProblem((held) => held ?? { source: 'catalogue', message: outcomeMessage(result) ?? 'Recorded connector state is unknown.' });
    }
  }, [binding, control]);

  const arbiter = useMemo(() => binding === null || context === null || control === null ? null : new WebhookLifecycleArbiter({
    issue: () => issueWebhook(context),
    read: () => getWebhookState(binding, control.signal),
    revoke: (id) => revokeWebhook(id, context),
    onReveal: (value) => revealExclusiveSecret(
      () => closeDockRef.current(),
      () => setSecret(value),
      flushSync,
    ),
    onState: (value) => {
      setWebhook(value);
      setConfirmRevoke(null);
      if (value !== null) setWebhookNeedsRefresh(false);
    },
  }), [binding, context, control]);

  useEffect(() => {
    if (control === null || arbiter === null) return undefined;
    dispatchCatalogue({ type: 'reset' }); setWebhook(null); setWebhookNeedsRefresh(false); setSecret(null); setProblem(null); finishPending();
    dispatchReceipt({ type: 'reset' }); setSelectedFile(null); setFilePreview(null); resetNativeFileSelection(fileInput.current); setGithubUrl(''); setGithubReview(null); setGitlabUrl(''); setGitlabReview(null);
    setHttpsUrl(''); setHttpsReview(null); setConfirmRevoke(null);
    void refreshCatalogue();
    void arbiter.refresh().then((result) => {
      if (result === 'indeterminate') { setWebhookNeedsRefresh(true); setProblem({ source: 'webhook', message: 'Webhook state could not be verified.' }); }
    });
    return () => { catalogueGeneration.current += 1; arbiter.dispose(); setSecret(null); };
  }, [arbiter, control, refreshCatalogue]);

  useEffect(() => {
    if (problem !== null && problem.source !== 'webhook') {
      document.getElementById(`connector-${problem.source}-error`)?.focus();
    }
  }, [problem]);

  if (session === null || context === null) return <p role="status">Checking the exact session.</p>;

  const status = (id: 'github' | 'gitlab' | 'markdown' | 'text' | 'pdf' | 'docx' | 'https_api' | 'webhook' | 'slack' | WorkSourceId) =>
    catalogue?.connectors.find((entry) => entry.id === id) ?? null;
  const currentStatus = (id: Parameters<typeof status>[0]) => catalogueState === 'ready' ? status(id) : null;
  const available = (id: Parameters<typeof status>[0]) => currentStatus(id)?.availability === 'available';
  const problemFor = (source: 'catalogue' | 'file' | 'github' | 'gitlab' | 'https' | 'webhook' | 'slack' | 'work') =>
    problem?.source === source ? problem.message : null;
  const selectedType = selectedFile === null ? null : /\.md$/iu.test(selectedFile.name) ? 'markdown'
    : /\.(?:txt|json|csv)$/iu.test(selectedFile.name) ? 'text' : /\.pdf$/iu.test(selectedFile.name) ? 'pdf'
      : /\.docx$/iu.test(selectedFile.name) ? 'docx' : null;

  async function previewSelected() {
    const held = selectedFile;
    if (held === null || held.size > 8 * 1024 * 1024 || selectedType === null) { setProblem({ source: 'file', message: 'Choose one .txt, .md, .json, .csv, .pdf, or .docx file smaller than 8 MiB.' }); return; }
    if (!available(selectedType)) { setProblem({ source: 'file', message: status(selectedType)?.availability === 'unavailable' ? 'This file importer is unavailable on this deployment.' : 'File import availability is unknown. Refresh recorded state.' }); return; }
    if (!beginPending('file-preview')) return;
    const generation = ++fileGeneration.current;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'file-preview' });
      setProblem(null); setFilePreview(null);
      const result = await previewFile(held, context!);
      if (generation === fileGeneration.current && result.kind === 'receipt') setFilePreview(result.value);
      else if (result.kind !== 'discarded') setProblem({ source: 'file', message: outcomeMessage(result) ?? 'File preview was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function importSelected() {
    const heldFile = selectedFile;
    const heldPreview = filePreview;
    if (heldFile === null || heldPreview === null) return;
    if (!beginPending('file-import')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'file-import' });
      setFilePreview(null); setSelectedFile(null); resetNativeFileSelection(fileInput.current); setProblem(null);
      const result = await importFile(heldFile, heldPreview.previewToken, context!);
      if (result.kind === 'receipt') dispatchReceipt({ type: 'received', receipt: result.value, reference: heldPreview.normalizedDigest });
      else if (result.kind !== 'discarded') setProblem({ source: 'file', message: outcomeMessage(result) ?? 'File import was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function confirmGithub() {
    const held = githubReview;
    if (held === null) return;
    if (!beginPending('github')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'github' });
      setGithubReview(null); setProblem(null);
      const result = await importGitHub(held, context!);
      if (result.kind === 'receipt') dispatchReceipt({ type: 'received', receipt: result.value, reference: result.value.snapshotDigest });
      else if (result.kind !== 'discarded') setProblem({ source: 'github', message: outcomeMessage(result) ?? 'GitHub import was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }


  async function confirmWork() {
    const held = workReview;
    if (held === null) return;
    if (!beginPending('work')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'work' });
      // The credential leaves component state before the request is even
      // awaited: whatever happens next, nothing here still holds it.
      setWorkReview(null); setWorkToken(''); setProblem(null);
      const result = await importWork(held, context!);
      setWorkRef('');
      if (result.kind === 'receipt') {
        dispatchReceipt({ type: 'received', receipt: result.value, reference: `${result.value.resourceRef} · ${result.value.itemCount} items` });
      } else if (result.kind !== 'discarded') {
        setProblem({ source: 'work', message: outcomeMessage(result) ?? 'The import was not confirmed.' });
      }
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  /**
   * The reviewed request, or null when the paste is not yet well formed. The
   * grammars mirror the server's exactly, so a refusal here is the same
   * refusal the server would make --- one round trip earlier.
   */
  function buildWorkRequest(): WorkImportRequest | null {
    const token = workToken.trim();
    const reference = workRef.trim();
    const site = workSite.trim().toLowerCase();
    const email = workEmail.trim();
    const atlassian = /^[a-z0-9][a-z0-9-]{1,60}$/u.test(site)
      && /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/u.test(email)
      && /^[A-Za-z0-9_=+/.-]{20,700}$/u.test(token);
    if (workSource === 'notion') {
      const found = /[0-9a-fA-F]{32}/u.exec(reference.replace(/-/gu, ''));
      if (found === null || !/^(?:ntn_|secret_)[A-Za-z0-9]{20,120}$/u.test(token)) return null;
      return { source: 'notion', page: found[0].toLowerCase(), token };
    }
    if (workSource === 'jira') {
      const issue = reference.toUpperCase();
      if (!atlassian || !/^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/u.test(issue)) return null;
      return { source: 'jira', site, email, token, issue };
    }
    if (workSource === 'confluence') {
      if (!atlassian || !/^\d{1,19}$/u.test(reference)) return null;
      return { source: 'confluence', site, email, token, page: reference };
    }
    if (!/^[0-9a-f]{1,20}$/u.test(reference) || !/^ya29\.[A-Za-z0-9_.-]{20,2000}$/u.test(token)) return null;
    return { source: 'gmail', thread: reference, token };
  }

  async function confirmSlack() {
    const heldChannel = slackReview;
    const heldToken = slackToken;
    if (heldChannel === null || heldToken === '') return;
    if (!beginPending('slack')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'slack' });
      // The token leaves component state before the request is even awaited:
      // whatever happens next, nothing here still holds it.
      setSlackReview(null); setSlackToken(''); setProblem(null);
      const result = await importSlack(heldChannel, heldToken, context!);
      setSlackChannel('');
      if (result.kind === 'receipt') dispatchReceipt({ type: 'received', receipt: result.value, reference: `${result.value.channelId} · ${result.value.messageCount} messages` });
      else if (result.kind !== 'discarded') setProblem({ source: 'slack', message: outcomeMessage(result) ?? 'Slack import was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function confirmGitlab() {
    const held = gitlabReview;
    if (held === null) return;
    if (!beginPending('gitlab')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'gitlab' });
      setGitlabReview(null); setProblem(null);
      const result = await importGitLab(held, context!);
      if (result.kind === 'receipt') dispatchReceipt({ type: 'received', receipt: result.value, reference: result.value.snapshotDigest });
      else if (result.kind !== 'discarded') setProblem({ source: 'gitlab', message: outcomeMessage(result) ?? 'GitLab import was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function confirmHttps() {
    const held = httpsReview;
    if (held === null) return;
    if (!beginPending('https')) return;
    try {
      dispatchReceipt({ type: 'dispatched', connector: 'https' });
      setHttpsReview(null); setProblem(null);
      const result = await importHttps(held.submitted, context!);
      setHttpsUrl('');
      if (result.kind === 'receipt') dispatchReceipt({ type: 'received', receipt: result.value, reference: result.value.contentDigest });
      else if (result.kind !== 'discarded') setProblem({ source: 'https', message: outcomeMessage(result) ?? 'HTTPS import was not confirmed.' });
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function setupWebhook() {
    if (!beginPending('webhook')) return;
    try {
      setProblem(null); setSecret(null);
      const result = await arbiter!.issue();
      if (typeof result === 'object') {
        if (!result.reconciled) setWebhookNeedsRefresh(true);
        setProblem({ source: 'webhook', message: outcomeMessage(result) ?? 'Webhook setup was safely refused.' });
      } else if (result === 'indeterminate') { setWebhookNeedsRefresh(true); setProblem({ source: 'webhook', message: 'Webhook setup is indeterminate. Check the authoritative state; do not issue again automatically.' }); }
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  async function removeWebhook() {
    const confirmation = confirmRevoke;
    if (confirmation === null || !beginPending('webhook-revoke')) return;
    commitAndRestoreWebhookTrigger(() => {
      setConfirmRevoke(null); setProblem(null); setSecret(null);
    }, flushSync, webhookTrigger.current);
    try {
      const result = await arbiter!.revoke(confirmation);
      commitAndRestoreWebhookTrigger(() => {
        finishPending();
        if (typeof result === 'object') {
          if (!result.reconciled) setWebhookNeedsRefresh(true);
          setProblem({ source: 'webhook', message: outcomeMessage(result) ?? 'Webhook revocation was safely refused.' });
        } else if (result === 'indeterminate') {
          setWebhookNeedsRefresh(true);
          setProblem({ source: 'webhook', message: 'Revocation could not be confirmed. Authoritative state was checked once; do not retry automatically.' });
        }
      }, flushSync, webhookTrigger.current);
      await refreshCatalogue();
    } finally {
      finishPending();
    }
  }

  function cancelWebhookRevoke() {
    commitAndRestoreWebhookTrigger(
      () => setConfirmRevoke(null),
      flushSync,
      webhookTrigger.current,
    );
  }

  async function refreshWebhookExplicitly() {
    if (!beginPending('webhook-state')) return;
    try {
      setWebhookNeedsRefresh(false); setProblem(null); setSecret(null);
      const result = await arbiter!.refresh();
      if (result === 'indeterminate') { setWebhookNeedsRefresh(true); setProblem({ source: 'webhook', message: 'Webhook state could not be verified. Try an explicit state refresh later.' }); }
    } finally {
      finishPending();
    }
  }

  return (
    <div className="connectors-page">
      <header className="connectors-hero"><span>PRIVATE IMPORTS</span><h1>Bring bounded context into this workspace.</h1><p>Files, public GitHub snapshots, and public HTTPS reads are reviewed one-off imports. GitLab project snapshots use the same bounded review flow. Configured signed webhooks accept bounded at-least-once deliveries without per-delivery manual review. Current operation receipts remain exact; recorded observations are separate and may lag.</p></header>
      {problemFor('catalogue') === null ? null : <div id="connector-catalogue-error" className="connector-alert" role="alert" tabIndex={-1}>{problemFor('catalogue')}</div>}
      {receiptPresentation === null ? null : <Receipt receipt={receiptPresentation.receipt} reference={receiptPresentation.reference} />}
      <Observation catalogue={catalogue} catalogueState={catalogueState} />
      {catalogueState === 'unknown' ? <button type="button" disabled={pending !== null} onClick={() => void refreshCatalogue()}>REFRESH RECORDED STATE</button> : null}

      <div className="connector-workflow-grid">
        <section id="file" className="connector-card" aria-labelledby="file-heading" tabIndex={-1}>
          <span className="connector-kicker">FILES · REVIEW THEN IMPORT</span><h2 id="file-heading">Text, Markdown, JSON, CSV, PDF, or DOCX</h2>
          <FileSourceField problem={problemFor('file')} disabled={pending !== null} inputRef={fileInput} onSelect={(file) => { fileGeneration.current += 1; setSelectedFile(file); setFilePreview(null); const nextProblem = fileSelectionProblem(file); setProblem((held) => nextProblem === null ? held?.source === 'file' ? null : held : { source: 'file', message: nextProblem }); }} />
          {selectedType === null ? null : <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus(selectedType)} unavailableCopy="This importer is unavailable on this deployment." />}
          <button type="button" disabled={selectedFile === null || selectedType === null || problemFor('file') !== null || !available(selectedType) || pending !== null} onClick={() => void previewSelected()}>{pending === 'file-preview' ? 'PREVIEWING…' : 'PREVIEW FILE'}</button>
          {filePreview === null ? null : <div className="connector-review"><h3>Review {filePreview.filename}</h3><p>{filePreview.excerpt}</p><dl><div><dt>CHARACTERS</dt><dd>{filePreview.characters}</dd></div><div><dt>TYPE</dt><dd>{filePreview.type.toUpperCase()}</dd></div></dl><button className="connector-primary" type="button" disabled={pending !== null || !available(filePreview.type)} onClick={() => void importSelected()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="work" className="connector-card" aria-labelledby="work-heading" tabIndex={-1}>
          <span className="connector-kicker">WORK · REVIEW THEN IMPORT</span><h2 id="work-heading">Work tool snapshot</h2>
          <p id="work-instructions">One bounded read of a single item your own credential can already see, imported as prose. The credential authorises these requests only and is never stored. No OAuth application of ours, no webhooks, no continuous sync.</p>
          <div className="connector-choice" role="radiogroup" aria-label="Work source">
            {WORK_SOURCES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={workSource === entry.id}
                className={workSource === entry.id ? 'connector-chip connector-chip-on' : 'connector-chip'}
                disabled={pending !== null}
                onClick={() => { setWorkSource(entry.id); setWorkReview(null); setWorkRef(''); setProblem((held) => held?.source === 'work' ? null : held); }}
              >{entry.name}</button>
            ))}
          </div>
          <ConnectorUrlField
            id="work-reference"
            instructionsId="work-instructions"
            errorId="connector-work-error"
            label={WORK_FIELD[workSource].label}
            name="work-reference"
            value={workRef}
            placeholder={WORK_FIELD[workSource].placeholder}
            problem={problemFor('work')}
            disabled={pending !== null}
            onChange={(value) => { setWorkRef(value); setWorkReview(null); setProblem((held) => held?.source === 'work' ? null : held); }}
          />
          {workSource === 'jira' || workSource === 'confluence' ? (
            <>
              <label className="connector-secret"><span>ATLASSIAN SITE</span>
                <input type="text" autoComplete="off" spellCheck={false} name="work-site" value={workSite} placeholder="your-team · from your-team.atlassian.net" disabled={pending !== null} onChange={(event) => { setWorkSite(event.target.value); setWorkReview(null); }} />
              </label>
              <label className="connector-secret"><span>ACCOUNT EMAIL</span>
                <input type="email" autoComplete="off" spellCheck={false} name="work-email" value={workEmail} placeholder="you@example.com" disabled={pending !== null} onChange={(event) => { setWorkEmail(event.target.value); setWorkReview(null); }} />
              </label>
            </>
          ) : null}
          <label className="connector-secret"><span>{WORK_FIELD[workSource].secret}</span>
            <input type="password" autoComplete="off" spellCheck={false} name="work-token" value={workToken} placeholder={WORK_FIELD[workSource].tokenHint} disabled={pending !== null} onChange={(event) => { setWorkToken(event.target.value); setWorkReview(null); }} />
          </label>
          <p className="connector-hint">{WORK_FIELD[workSource].help}</p>
          <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus(workSource)} unavailableCopy="Work-tool imports are unavailable on this deployment." />
          <button type="button" disabled={pending !== null || !available(workSource)} onClick={() => { const built = buildWorkRequest(); setWorkReview(built); if (built === null) setProblem({ source: 'work', message: WORK_FIELD[workSource].refusal }); }}>REVIEW ONE READ</button>
          {workReview === null ? null : <div className="connector-review"><h3>Review one item read</h3><p>{workReview.source === 'notion' ? workReview.page : workReview.source === 'jira' ? workReview.issue : workReview.source === 'confluence' ? workReview.page : workReview.thread}</p><p>A small fixed number of requests resolve one item. The credential is sent to this site only and discarded after the read. It will not create a connection.</p><button className="connector-primary" type="button" disabled={pending !== null} onClick={() => void confirmWork()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="slack" className="connector-card" aria-labelledby="slack-heading" tabIndex={-1}>
          <span className="connector-kicker">WORK · REVIEW THEN IMPORT</span><h2 id="slack-heading">Slack channel snapshot</h2>
          <p id="slack-instructions">One bounded read of a channel your own Slack app can see: the latest page of conversation, imported as a transcript. The token authorises these requests only and is never stored. No OAuth application of ours, no events, no continuous sync.</p>
          <ConnectorUrlField id="slack-channel" instructionsId="slack-instructions" errorId="connector-slack-error" label="CHANNEL ID" name="slack-channel-id" value={slackChannel} placeholder="C0123ABCDEF · channel details, About, Channel ID" problem={problemFor('slack')} disabled={pending !== null} onChange={(value) => { setSlackChannel(value); setSlackReview(null); setProblem((held) => held?.source === 'slack' ? null : held); }} />
          <label className="connector-field"><span>BOT OR USER TOKEN · USED ONCE, NEVER STORED</span>
            <input type="password" autoComplete="off" spellCheck={false} name="slack-token" value={slackToken} placeholder="xoxb-…" disabled={pending !== null} onChange={(event) => { setSlackToken(event.target.value); setSlackReview(null); }} />
          </label>
          <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus('slack')} unavailableCopy="Slack import is unavailable on this deployment." />
          <button type="button" disabled={pending !== null || !available('slack')} onClick={() => { const held = slackChannel.trim().toUpperCase(); const ok = /^[CGD][A-Z0-9]{6,20}$/u.test(held) && /^xox[bpe]-[A-Za-z0-9-]{10,250}$/u.test(slackToken.trim()); setSlackReview(ok ? held : null); if (!ok) setProblem({ source: 'slack', message: 'Enter a Slack channel ID such as C0123ABCDEF and an xoxb or xoxp token.' }); }}>REVIEW CHANNEL READ</button>
          {slackReview === null ? null : <div className="connector-review"><h3>Review one channel read</h3><p>{slackReview}</p><p>Four requests resolve one page of conversation. The token is sent to this site only and discarded after the read. It will not create a connection.</p><button className="connector-primary" type="button" disabled={pending !== null} onClick={() => void confirmSlack()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="github" className="connector-card" aria-labelledby="github-heading" tabIndex={-1}>
          <span className="connector-kicker">CODE · MANUAL SNAPSHOT</span><h2 id="github-heading">Public GitHub repository snapshot</h2>
          <p id="github-instructions">Imports the immutable default-branch commit and bounded supported text files. No OAuth, private repositories, cloning, branch sync, or continuous sync.</p>
          <ConnectorUrlField id="github-url" instructionsId="github-instructions" errorId="connector-github-error" label="CANONICAL REPOSITORY ROOT" name="public-github-repository" value={githubUrl} placeholder="https://github.com/owner/repository" problem={problemFor('github')} disabled={pending !== null} onChange={(value) => { setGithubUrl(value); setGithubReview(null); setProblem((held) => held?.source === 'github' ? null : held); }} />
          <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus('github')} unavailableCopy="GitHub import is unavailable on this deployment." />
          <button type="button" disabled={pending !== null || !available('github')} onClick={() => { const next = canonicalGitHubReview(githubUrl); setGithubReview(next); if (next === null) setProblem({ source: 'github', message: 'Enter one public GitHub repository root, for example https://github.com/owner/repository.' }); }}>REVIEW SNAPSHOT</button>
          {githubReview === null ? null : <div className="connector-review"><h3>Review manual import</h3><p>{githubReview}</p><p>One request resolves one default-branch commit. It will not create a connection.</p><button className="connector-primary" type="button" disabled={pending !== null} onClick={() => void confirmGithub()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="gitlab" className="connector-card" aria-labelledby="gitlab-heading" tabIndex={-1}>
          <span className="connector-kicker">CODE · MANUAL SNAPSHOT</span><h2 id="gitlab-heading">Public GitLab project snapshot</h2>
          <p id="gitlab-instructions">Imports the immutable default-branch commit and bounded supported text files. No OAuth, private projects, cloning, branch sync, or continuous sync.</p>
          <ConnectorUrlField id="gitlab-url" instructionsId="gitlab-instructions" errorId="connector-gitlab-error" label="CANONICAL PROJECT ROOT" name="public-gitlab-project" value={gitlabUrl} placeholder="https://gitlab.com/group/project" problem={problemFor('gitlab')} disabled={pending !== null} onChange={(value) => { setGitlabUrl(value); setGitlabReview(null); setProblem((held) => held?.source === 'gitlab' ? null : held); }} />
          <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus('gitlab')} unavailableCopy="GitLab import is unavailable on this deployment." />
          <button type="button" disabled={pending !== null || !available('gitlab')} onClick={() => { const next = canonicalGitLabReview(gitlabUrl); setGitlabReview(next); if (next === null) setProblem({ source: 'gitlab', message: 'Enter one public GitLab project root, for example https://gitlab.com/group/project.' }); }}>REVIEW SNAPSHOT</button>
          {gitlabReview === null ? null : <div className="connector-review"><h3>Review manual import</h3><p>{gitlabReview}</p><p>One request resolves one default-branch commit. It will not create a connection.</p><button className="connector-primary" type="button" disabled={pending !== null} onClick={() => void confirmGitlab()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="https-api" className="connector-card" aria-labelledby="https-heading" tabIndex={-1}>
          <span className="connector-kicker">DATA · ONE PUBLIC READ</span><h2 id="https-heading">Public HTTPS JSON/text</h2>
          <p id="https-instructions">No credentials, custom headers, redirects, private/internal hosts, pagination, scheduled sync, or automatic retry.</p>
          <ConnectorUrlField id="https-source-url" instructionsId="https-instructions" errorId="connector-https-error" label="PUBLIC HTTPS URL" name="public-source-url" value={httpsUrl} placeholder="https://api.example.com/public-data" problem={problemFor('https')} disabled={pending !== null} onChange={(value) => { setHttpsUrl(value); setHttpsReview(null); setProblem((held) => held?.source === 'https' ? null : held); }} />
          <ConnectorAvailabilityNotice catalogueState={catalogueState} connector={currentStatus('https_api')} unavailableCopy="HTTPS import is unavailable on this deployment." />
          <button type="button" disabled={pending !== null || !available('https_api')} onClick={() => { const next = safeHttpsReview(httpsUrl); setHttpsReview(next); if (next === null) setProblem({ source: 'https', message: 'Enter one public HTTPS URL without credentials or a fragment.' }); }}>REVIEW PUBLIC READ</button>
          {httpsReview === null ? null : <div className="connector-review"><h3>Review one public read</h3><p>{httpsReview.displayed}</p>{httpsReview.queryPresent ? <p>QUERY PRESENT · kept private and never repeated in a receipt or error.</p> : null}<button className="connector-primary" type="button" disabled={pending !== null} onClick={() => void confirmHttps()}>CONFIRM ONE IMPORT</button></div>}
        </section>

        <section id="webhook" className="connector-card" aria-labelledby="webhook-heading" tabIndex={-1}>
          <span className="connector-kicker">DATA · SIGNED DELIVERY</span><h2 id="webhook-heading">Signed webhook</h2>
          <p>At-least-once delivery with a one-time signing secret. Each valid signed event is a bounded at-least-once delivery, not a manually reviewed one-off import. Setup and revocation are process-local bounded operations, not globally linearizable.</p>
          <WebhookLifecycleControl connector={status('webhook')} catalogueState={catalogueState} webhook={webhook} pending={pending} needsRefresh={webhookNeedsRefresh} confirmRevoke={confirmRevoke} triggerRef={webhookTrigger} problem={problemFor('webhook')} onSetup={() => void setupWebhook()} onRequestRevoke={() => setConfirmRevoke(arbiter!.captureRevoke())} onConfirmRevoke={() => void removeWebhook()} onCancelRevoke={cancelWebhookRevoke} onRefresh={() => void refreshWebhookExplicitly()} />
        </section>
      </div>

      <section className="connector-planned" aria-labelledby="planned-heading"><span className="connector-kicker">ROADMAP</span><h2 id="planned-heading">Planned sources</h2><div>{CONNECTOR_PRESENTATION.filter((item) => item.implementation === 'planned').map((item) => <article key={item.key} aria-disabled="true"><h3>{item.name}</h3><span>PLANNED</span><p>No connection control is available.</p></article>)}</div></section>
      {secret === null ? null : <SecretModal issued={secret} acknowledge={() => setSecret(null)} returnTarget={webhookTrigger} />}
    </div>
  );
}

export function ExploreConnectors() {
  const card = (item: (typeof CONNECTOR_PRESENTATION)[number]) => (
    <article key={item.key}><span className="connector-kicker">{item.group}</span><h3>{item.name}</h3><p>{item.summary}</p><strong>{item.implementation === 'planned' ? 'PLANNED' : 'PRIVATE WORKFLOW'}</strong></article>
  );
  const workflow = (name: 'github' | 'gitlab' | 'https' | 'webhook') => CONNECTOR_PRESENTATION.find((item) => item.workflow === name);
  return (
    <div className="connectors-page connectors-explore">
      <header className="connectors-hero"><span>EXPLORE · READ ONLY</span><h1>Import workflows, without private controls.</h1><p>Sign in to check deployment availability and use the appropriate reviewed one-off import or signed-delivery setup. This public page does not request workspace state.</p></header>
      <section id="file" tabIndex={-1} aria-labelledby="explore-file-heading"><h2 id="explore-file-heading">Reviewed files</h2><div className="connector-observation-grid">{CONNECTOR_PRESENTATION.filter((item) => item.workflow === 'file').map(card)}</div></section>
      {(['github', 'gitlab', 'https', 'webhook'] as const).map((name) => {
        const item = workflow(name);
        const target = name === 'https' ? 'https-api' : name;
        return item === undefined ? null : <section key={name} id={target} tabIndex={-1} aria-labelledby={`explore-${target}-heading`}><h2 id={`explore-${target}-heading`}>{item.name}</h2><div className="connector-observation-grid">{card(item)}</div></section>;
      })}
      <section aria-labelledby="explore-planned-heading"><h2 id="explore-planned-heading">Planned sources</h2><div className="connector-observation-grid">{CONNECTOR_PRESENTATION.filter((item) => item.workflow === 'planned').map(card)}</div></section>
    </div>
  );
}

function ConnectorAnchorFocus() {
  const { hash } = useLocation();
  useEffect(() => {
    const id = connectorAnchorTarget(hash);
    if (id !== null) document.getElementById(id)?.focus();
  }, [hash]);
  return null;
}


/** The four reviewed work-tool reads, and what each one asks the reader for. */
const WORK_SOURCES: readonly { readonly id: WorkSourceId; readonly name: string }[] = [
  { id: 'notion', name: 'Notion' },
  { id: 'jira', name: 'Jira' },
  { id: 'confluence', name: 'Confluence' },
  { id: 'gmail', name: 'Gmail' },
];

const WORK_FIELD: Readonly<Record<WorkSourceId, {
  readonly label: string;
  readonly placeholder: string;
  readonly secret: string;
  readonly tokenHint: string;
  readonly help: string;
  readonly refusal: string;
}>> = {
  notion: {
    label: 'PAGE ID OR URL',
    placeholder: 'notion.so/Ledger-rollout-0123… · or the bare id',
    secret: 'INTERNAL INTEGRATION TOKEN · USED ONCE, NEVER STORED',
    tokenHint: 'ntn_…',
    help: 'Create an internal integration at notion.so/my-integrations, then share the page with it. Read access is enough.',
    refusal: 'Enter a Notion page id or URL and an ntn_ integration token.',
  },
  jira: {
    label: 'ISSUE KEY',
    placeholder: 'AUTH-412',
    secret: 'API TOKEN · USED ONCE, NEVER STORED',
    tokenHint: 'API token from id.atlassian.com',
    help: 'Create an API token at id.atlassian.com/manage-profile/security/api-tokens. It pairs with your account email.',
    refusal: 'Enter an issue key such as AUTH-412, your site, your account email, and an API token.',
  },
  confluence: {
    label: 'PAGE ID',
    placeholder: '65601 · the numeric id in the page URL',
    secret: 'API TOKEN · USED ONCE, NEVER STORED',
    tokenHint: 'API token from id.atlassian.com',
    help: 'The same Atlassian API token as Jira. The page id is the number in /pages/<id>/ in the page URL.',
    refusal: 'Enter a numeric page id, your site, your account email, and an API token.',
  },
  gmail: {
    label: 'THREAD ID',
    placeholder: '18f2a9c4bb01 · the id after #inbox/ in the URL',
    secret: 'OAUTH ACCESS TOKEN · SHORT LIVED, NEVER STORED',
    tokenHint: 'ya29.…',
    help: 'Gmail issues no long-lived token, so this takes a short-lived OAuth access token from the Google OAuth Playground with the gmail.readonly scope. It expires in about an hour, which is the point.',
    refusal: 'Enter a Gmail thread id and a ya29 access token with the gmail.readonly scope.',
  },
};

export function ConnectorsRoute() {
  const scope = useScope();
  return <><ConnectorAnchorFocus />{scope.demo ? <ExploreConnectors /> : <PrivateConnectors />}</>;
}
