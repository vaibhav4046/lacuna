import { useState } from 'react';

import { MONO } from '../../design/mark';
import { useScope } from '../../api/scope';
import { csrfHeaders } from '../../api/client';

/**
 * Two agents over the governed context, and what they refused.
 *
 * The interesting part of a run here is not the prose. It is the order: the
 * resolver decides what is current before the model sees anything, so the pack
 * the Researcher reads already carries each claim's standing, and the Reviewer
 * then checks the draft against that same evidence in a fresh context.
 *
 * So the screen shows the run rather than just its output. The stages with
 * their real timings, the pack it compiled, what crossed in the handoff, and
 * the verdict with the claims nothing supported. A run that produced a draft
 * and could not be reviewed is shown as exactly that, never as an answer.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;

interface PackedClaim {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly standing: string;
}

interface RunEvent {
  readonly stage: string;
  readonly detail: string;
  readonly ms?: number;
}

interface Verdict {
  readonly approved: boolean;
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
  readonly note: string;
}

interface AgentRun {
  readonly status: string;
  readonly ms: number;
  readonly error: string | null;
  readonly draft: string | null;
  readonly verdict: Verdict | null;
  readonly events: readonly RunEvent[];
  readonly manifest: { readonly model: string; readonly canWrite: boolean };
  readonly pack: { readonly claims: readonly PackedClaim[]; readonly estimatedTokens: number } | null;
  readonly handoff: { readonly supportedFacts: readonly string[] } | null;
}

const ERROR_COPY: Readonly<Record<string, string>> = {
  no_known_subject: 'That task did not name anything this workspace holds. Add a source first, or ask about a subject it already has.',
  rate_limited: 'The model provider is rate limiting. The draft below was written but never reviewed, so it is not an answer.',
  review_unavailable: 'The Reviewer could not be reached. The draft below was written but never checked, so it is not an answer.',
  model_unavailable: 'The model provider did not answer, so nothing was drafted.',
};

export function Agents() {
  const { demo } = useScope();
  const [task, setTask] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setProblem(null);
    setRun(null);
    try {
      /**
       * A run writes nothing, so the public corpus can have one too. Reading
       * the public collection needs no session and therefore no CSRF token;
       * a run over somebody's own workspace needs both.
       */
      const response = await fetch(demo ? '/api/explore/agent/run' : '/api/workspace/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(demo ? {} : csrfHeaders()) },
        body: JSON.stringify({ task }),
      });
      if (response.status === 429) {
        setProblem('Too many runs from this address in the last minute. A run spends two model calls, so the public budget is small. Try again shortly.');
        return;
      }
      if (response.status === 401) {
        setProblem('Sign in first. A run reads the workspace you ingested into.');
        return;
      }
      if (response.status === 501) {
        setProblem('No model provider is configured on this deployment.');
        return;
      }
      setRun(await response.json() as AgentRun);
    } catch {
      setProblem('The run did not complete.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div>
        <div style={{ ...head, paddingBottom: '6px' }}>RESEARCHER · REVIEWER</div>
        <p style={{ fontSize: '14.5px', color: '#BDBDBD', margin: 0, maxWidth: '76ch', lineHeight: 1.6 }}>
          The Researcher reads the resolved claims for whatever the task names and reports what
          they support. The Reviewer then checks that draft against the same evidence and names
          anything nothing supports. The resolver decides what is current before either of them
          runs, so neither model is asked to work out what is true.
        </p>
      </div>

      {demo ? (
        <div style={{ ...note, color: '#9A9A9A' }}>
          RUNNING OVER THE PUBLIC CORPUS · NO ACCOUNT NEEDED · WRITES NOTHING
        </div>
      ) : null}

      <>
          <textarea
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Ask something about this workspace, for example: what is the current storage, and what changed?"
            rows={3}
            maxLength={600}
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px',
              padding: '11px 13px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px',
              outline: 'none', resize: 'vertical', lineHeight: 1.6,
            }}
          />
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="hv-text"
              disabled={busy || task.trim() === ''}
              onClick={() => void go()}
              style={{
                background: 'none', cursor: busy ? 'default' : 'pointer', borderRadius: '7px',
                padding: '9px 15px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em',
                border: '1px solid rgba(128,82,255,0.55)', color: busy ? '#7A7A7A' : '#FFFFFF',
              }}
            >
              {busy ? 'RUNNING…' : 'RUN'}
            </button>
            {problem === null ? null : (
              <span style={{ fontSize: '13px', color: '#FFB829', maxWidth: '62ch' }}>{problem}</span>
            )}
          </div>
      </>

      {run === null ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '20px' }}>
          <div style={{ ...note, display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
            <span style={{ color: run.status === 'COMPLETED' ? '#8052FF' : '#FFB829' }}>{run.status}</span>
            <span>{run.manifest.model}</span>
            <span>{run.ms} MS</span>
            {run.pack === null ? null : <span>{run.pack.claims.length} RESOLVED CLAIMS · {run.pack.estimatedTokens} TOKENS</span>}
            <span>{run.manifest.canWrite ? 'CAN WRITE' : 'CANNOT WRITE TO MEMORY'}</span>
          </div>

          {run.error === null ? null : (
            <span style={{ fontSize: '14px', color: '#FFB829', maxWidth: '72ch', lineHeight: 1.6 }}>
              {ERROR_COPY[run.error] ?? `The run failed: ${run.error}.`}
            </span>
          )}

          <div>
            <div style={{ ...head, paddingBottom: '6px' }}>STAGES</div>
            {run.events.map((event, index) => (
              <div key={index} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', padding: '4px 0', fontFamily: MONO, fontSize: '11.5px' }}>
                <span style={{ color: '#7A7A7A', minWidth: '92px' }}>{event.stage}</span>
                <span style={{ color: '#BDBDBD' }}>{event.detail}</span>
                {event.ms === undefined ? null : <span style={{ color: '#7A7A7A' }}>{event.ms}ms</span>}
              </div>
            ))}
          </div>

          {run.pack === null || run.pack.claims.length === 0 ? null : (
            <div>
              <div style={{ ...head, paddingBottom: '6px' }}>CONTEXT PACK · WHAT THE MODEL WAS GIVEN</div>
              {run.pack.claims.map((claim, index) => (
                <div key={index} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', padding: '4px 0', fontFamily: MONO, fontSize: '11.5px', flexWrap: 'wrap' }}>
                  <span style={{ color: '#FFFFFF' }}>{claim.subject} {claim.predicate} = {claim.value}</span>
                  <span style={{ color: claim.standing === 'current' ? '#8052FF' : '#7A7A7A', fontSize: '9.5px', letterSpacing: '0.14em' }}>
                    {claim.standing.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {run.handoff === null ? null : (
            <div>
              <div style={{ ...head, paddingBottom: '6px' }}>HANDOFF · WHAT CROSSED TO THE REVIEWER</div>
              <span style={{ fontSize: '13px', color: '#9A9A9A', lineHeight: 1.6 }}>
                {run.handoff.supportedFacts.join(' · ') || 'nothing current'}
              </span>
              <div style={{ ...note, paddingTop: '4px' }}>THE FACTS AND THE EVIDENCE, NOT THE DRAFT AND NOT THE REASONING</div>
            </div>
          )}

          {run.draft === null ? null : (
            <div>
              <div style={{ ...head, paddingBottom: '6px' }}>
                {run.verdict === null ? 'DRAFT · NEVER REVIEWED, NOT AN ANSWER' : 'DRAFT'}
              </div>
              <p style={{ fontSize: '15px', color: run.verdict === null ? '#9A9A9A' : '#FFFFFF', margin: 0, maxWidth: '74ch', lineHeight: 1.6 }}>
                {run.draft}
              </p>
            </div>
          )}

          {run.verdict === null ? null : (
            <div>
              <div style={{ ...head, paddingBottom: '6px' }}>VERDICT</div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: run.verdict.approved ? '#8052FF' : '#FFB829' }}>
                  {run.verdict.approved ? 'EVERY CLAIM SUPPORTED' : 'REVISION REQUIRED'}
                </span>
                <span style={{ fontSize: '13.5px', color: '#9A9A9A' }}>{run.verdict.note}</span>
              </div>
              {run.verdict.unsupported.length === 0 ? null : (
                <div style={{ paddingTop: '8px' }}>
                  <div style={{ ...note, color: '#FFB829', paddingBottom: '4px' }}>NOTHING SUPPORTS THESE</div>
                  {run.verdict.unsupported.map((claim, index) => (
                    <div key={index} style={{ fontSize: '13.5px', color: '#BDBDBD', padding: '2px 0' }}>{claim}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
