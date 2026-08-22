import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postFor, postJson } from '../api/client';
import { hydraState, useHealth, UNCHECKED } from '../api/health';
import { useSession } from '../api/session';
import { icStyle } from '../design/icons';
import { MONO, Mark } from '../design/mark';
import { retryWhilePending, storageProblem, storageReadiness } from './readiness';

/** The private answer contract used by the final first-run proof. */
export interface OnboardingAnswer {
  readonly reading: { readonly subject: string; readonly predicate: string; readonly via: string | null } | null;
  readonly unread: string | null;
  readonly knownSubjects: readonly string[];
  readonly available: readonly string[];
  readonly answer: {
    readonly status: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';
    readonly answer: string | null;
    readonly evidence: readonly unknown[];
    readonly abstain_reason: string | null;
  } | null;
  readonly ms: number;
}

const DASHBOARD_PATH = '/app/dash';
const FIRST_MEMORY_TITLE = 'First private memory';
const EXAMPLE_SOURCE = 'Session data is stored in HydraDB Cloud.';
const EXAMPLE_QUESTION = 'Where is session data stored?';

const STEPS = [
  { l: 'CREATE WORKSPACE', t: 'Name your workspace.', b: 'One workspace holds the memory for a project or a team.' },
  { l: 'CHECK STORAGE', t: 'Check memory storage.', b: 'Lacuna checks that HydraDB is ready to store your project memory.' },
  { l: 'MODEL SETUP', t: 'Check model setup.', b: 'The server chooses the model for now. Switching models per workspace is planned.' },
  { l: 'ADD MEMORY', t: 'Store your first private memory.', b: 'Start with one note you control. After this setup, Memory also supports a one-off file, public GitHub snapshot, public HTTPS source, or signed bounded at-least-once webhook delivery.' },
  { l: 'ASK SOMETHING', t: 'Prove the memory is useful.', b: 'Ask a question and see the private answer, its source, and any disagreement before opening the full workspace.' },
] as const;

const label = { fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.2em' } as const;
const chip = { border: '1px solid rgba(255,255,255,0.16)', borderRadius: '7px', padding: '8px 12px', color: '#BDBDBD' } as const;
const field = { background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '8px', padding: '13px 14px', color: '#FFFFFF', fontSize: '15px', outline: 'none', width: 'min(520px, 100%)', boxSizing: 'border-box' } as const;

function ingestProblem(status: number): string {
  if (status === 401 || status === 403) return 'Your session changed. Sign in again to continue setup.';
  if (status === 413) return 'That note is too large. Keep the first memory under the workspace limit.';
  if (status === 429) return 'The workspace write limit was reached. Wait a moment and try again.';
  return 'The first memory could not be accepted. Nothing was added to this workspace.';
}

function answerProblem(result: OnboardingAnswer | null): string {
  if (result === null) return 'The private question did not reach the context store.';
  if (result.answer === null) return 'No private answer was returned. Edit the note or question and try again.';
  if (result.answer.status !== 'ANSWERED') return 'The private store answered without a supported fact. Edit the note or question and try again.';
  return '';
}

export default function Onboarding() {
  const go = useNavigate();
  const { loaded, refreshAfterMutation } = useSession();
  const sessionBinding = loaded.state === 'ready' && loaded.value.signedIn
    ? loaded.value.session.binding
    : null;
  const health = useHealth();
  const [step, setStep] = useState(0);
  const [workspace, setWorkspace] = useState('');
  const [sourceTitle, setSourceTitle] = useState(FIRST_MEMORY_TITLE);
  const [sourceText, setSourceText] = useState('');
  const [question, setQuestion] = useState(EXAMPLE_QUESTION);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [sourceStored, setSourceStored] = useState(false);
  const [receipt, setReceipt] = useState<{ readonly accepted: number; readonly searchable: boolean } | null>(null);
  const [answer, setAnswer] = useState<OnboardingAnswer['answer'] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hydra = hydraState(health);
  const current = STEPS[step] ?? STEPS[0];

  async function createWorkspace(): Promise<boolean> {
    const name = workspace.trim();
    if (name === '') { setProblem('Name your workspace first.'); return false; }
    setBusy(true);
    try {
      const result = await postJson('/api/workspace', { workspace: name }, 15_000, sessionBinding ?? undefined);
      if (!result.ok) { setProblem('The workspace could not be created.'); return false; }
      setWorkspaceReady(true);
      setProblem(null);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function storeFirstMemory(): Promise<boolean> {
    const text = sourceText.trim();
    if (text === '') { setProblem('Add a note or choose Use example before storing.'); return false; }
    if (sourceTitle.trim() === '') { setProblem('Give the first memory a title.'); return false; }
    setBusy(true);
    try {
      const result = await postJson('/api/workspace/ingest', { title: sourceTitle.trim(), text }, 15_000, sessionBinding ?? undefined);
      if (!result.ok) { setProblem(ingestProblem(result.status)); return false; }
      const body = result.body;
      if (typeof body !== 'object' || body === null || (body as { ok?: unknown }).ok !== true) {
        setProblem('No structured memory was extracted. Try a direct statement such as “Session data is stored in HydraDB Cloud.”');
        return false;
      }
      const report = body as { accepted?: unknown; searchable?: unknown };
      const accepted = typeof report.accepted === 'number' ? report.accepted : 0;
      if (accepted <= 0) {
        setProblem('The store accepted no searchable record. Edit the note and try again.');
        return false;
      }
      setReceipt({ accepted, searchable: report.searchable === true });
      setSourceStored(true);
      setProblem(null);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function proveAnswer(): Promise<boolean> {
    const text = question.trim();
    if (text === '') { setProblem('Ask one private question first.'); return false; }
    setBusy(true);
    try {
      const result = await retryWhilePending(
        () => postFor<OnboardingAnswer>('/api/workspace/query', { question: text }, 15_000, sessionBinding ?? undefined),
        (value) => receipt?.searchable === false
          && (value === null || value.answer === null || value.answer.status === 'NO_EVIDENCE'),
        { attempts: receipt?.searchable === false ? 4 : 1 },
      );
      const reason = answerProblem(result);
      if (reason !== '') { setProblem(reason); return false; }
      setAnswer(result?.answer ?? null);
      setProblem(null);
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (busy) return;
    setProblem(null);
    if (step === 0) {
      if (!workspaceReady && !(await createWorkspace())) return;
      setStep(1);
      return;
    }
    if (step === 3) {
      if (!sourceStored && !(await storeFirstMemory())) return;
      setStep(4);
      return;
    }
    if (step === 1) {
      const problem = storageProblem(storageReadiness(hydra));
      if (problem !== null) { setProblem(problem); return; }
    }
    if (step === 4) {
      if (answer === null) { await proveAnswer(); return; }
      setBusy(true);
      try {
        const session = await refreshAfterMutation();
        if (session === null || !session.signedIn || session.session.workspace === null) {
          setProblem('Your workspace was created, but the session could not be confirmed. Try again.');
          return;
        }
        go(DASHBOARD_PATH);
        window.scrollTo(0, 0);
      } finally {
        setBusy(false);
      }
      return;
    }
    setStep(step + 1);
  }

  return (
    <div style={{ position: 'relative', zIndex: 1, minHeight: '100vh', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 'clamp(40px, 6vw, 110px)', flexWrap: 'wrap', padding: '80px clamp(24px, 6vw, 110px)' }}>
      <div style={{ width: 'min(300px, 100%)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '26px' }}><Mark size={19} /><span style={{ fontSize: '14px', fontWeight: 500, color: '#FFFFFF' }}>Lacuna</span></div>
        {STEPS.map((s, i) => (
          <div key={s.l} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            {i === step ? <><span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#8052FF', flexShrink: 0 }}></span><span style={{ ...label, color: '#FFFFFF' }}>{s.l}</span></> : i < step ? <><span style={{ width: '5px', height: '5px', borderRadius: '50%', border: '1.5px solid #15846E', boxSizing: 'border-box', flexShrink: 0 }}></span><span style={{ ...label, color: '#7A7A84' }}>{s.l}</span></> : <><span style={{ width: '5px', height: '5px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.25)', flexShrink: 0 }}></span><span style={{ ...label, color: '#7A7A84' }}>{s.l}</span></>}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 'min(420px, 90vw)', maxWidth: '560px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: 'clamp(32px, 3.6vw, 56px)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>{current.t}</h1>
        <p style={{ fontSize: '17px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '46ch' }}>{current.b}</p>

        {step === 0 ? <input className="fv-violet" type="text" placeholder="acme / backend" value={workspace} onChange={(e) => setWorkspace(e.target.value)} style={field} /> : null}
        {step === 1 ? <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.12em' }}><span style={{ color: '#9A9A9A' }}>ENDPOINT · {hydra === UNCHECKED ? UNCHECKED : hydra === 'NOT CONFIGURED' ? 'not configured' : 'configured'}</span><span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={icStyle('HydraDB', 13)}></span><span style={{ color: '#BDBDBD' }}>HYDRADB {hydra}</span></span></div> : null}
        {step === 2 ? <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.1em' }}><span style={{ color: '#FFFFFF' }}>SERVER MODEL · CONFIGURED BY DEPLOYMENT</span><span style={{ color: '#7A7A84' }}>MODEL SWITCHING · PLANNED</span></div> : null}
        {step === 3 ? <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}><label style={{ ...label, color: '#9A9A9A' }} htmlFor="onboarding-source-title">MEMORY TITLE</label><input id="onboarding-source-title" className="fv-violet" type="text" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} style={field} disabled={sourceStored} /><label style={{ ...label, color: '#9A9A9A' }} htmlFor="onboarding-source-text">PRIVATE NOTE</label><textarea id="onboarding-source-text" className="fv-violet" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Session data is stored in HydraDB Cloud." rows={5} style={{ ...field, resize: 'vertical', lineHeight: 1.55 }} disabled={sourceStored} /><div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}><button type="button" disabled={busy || sourceStored} onClick={() => setSourceText(EXAMPLE_SOURCE)} style={{ ...chip, cursor: sourceStored ? 'default' : 'pointer', background: 'transparent' }}>USE EXAMPLE</button>{sourceStored ? <span role="status" style={{ ...label, color: '#B79BFF', alignSelf: 'center' }}>{receipt?.accepted ?? 0} RECORDS ACCEPTED · {receipt?.searchable ? 'SEARCHABLE' : 'INDEXING'}</span> : null}</div></div> : null}
        {step === 4 ? <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}><label style={{ ...label, color: '#9A9A9A' }} htmlFor="onboarding-question">PRIVATE QUESTION</label><input id="onboarding-question" className="fv-violet" type="text" value={question} onChange={(event) => { setQuestion(event.target.value); setAnswer(null); }} style={field} disabled={answer !== null} />{answer === null ? <span style={{ ...label, color: '#7A7A84' }}>This reads only the workspace you just created.</span> : <div role="status" style={{ border: '1px solid rgba(128,82,255,0.42)', borderRadius: '10px', padding: '14px 18px', color: '#FFFFFF' }}><span style={{ ...label, color: '#B79BFF' }}>PRIVATE ANSWER · {answer.status}</span><p style={{ margin: '10px 0 0', color: '#D8D4E2', lineHeight: 1.6 }}>{answer.answer}</p><span style={{ ...label, display: 'block', marginTop: '10px', color: '#7A7A84' }}>SOURCE-BACKED RESULT · READY TO OPEN</span></div>}</div> : null}
        {step === 3 && workspaceReady ? <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.14em' }}><span style={chip}>GITHUB SNAPSHOT · AVAILABLE</span><span style={chip}>TXT · MD · JSON · CSV · PDF · DOCX · AVAILABLE</span><span style={chip}>HTTPS + WEBHOOK · AVAILABLE</span></div> : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', marginTop: '8px' }}><button className="hv-violet" type="button" disabled={busy} onClick={() => void next()} style={{ background: '#8052FF', border: 'none', cursor: busy ? 'wait' : 'pointer', color: '#FFFFFF', fontSize: '14.5px', fontWeight: 500, padding: '12px 22px', borderRadius: '8px' }}>{step === 3 && !sourceStored ? 'STORE FIRST MEMORY' : step === 4 && answer === null ? 'CHECK PRIVATE ANSWER' : step === 4 ? 'OPEN LACUNA' : 'Continue'}</button>{step > 0 && answer === null ? <button className="hv-text" type="button" onClick={() => { setProblem(null); setStep(Math.max(0, step - 1)); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9A9A9A', fontSize: '14px', padding: 0 }}>Back</button> : null}</div>
        {problem === null ? null : <span role="alert" style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#FFB829' }}>{problem}</span>}
      </div>
    </div>
  );
}
