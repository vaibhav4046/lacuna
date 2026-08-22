import { useRef, useState } from 'react';

import { postFor, postJson } from '../../api/client';
import { createClientUuid } from '../../api/request-id';
import { useScope, useScoped } from '../../api/scope';
import { useSession } from '../../api/session';
import { MONO } from '../../design/mark';
import { guardedAction } from '../agent-actions';
import type { AgentRecommendationRecord, AgentRecord, AgentRunRecord, DailyScheduleRecord } from '../agents/contracts';
import { Empty, Failed, Stage } from '../state';

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#7A7A7A' } as const;
const AGENT_REQUEST_TIMEOUT_MS = 65_000;

const ERROR_COPY: Readonly<Record<string, string>> = {
  no_known_subject: 'That task did not name anything this workspace holds.',
  context_unavailable: 'The context resolver did not return a usable pack.',
  over_budget: 'The run stopped at its configured wall-time budget.',
  rate_limited: 'The provider is rate limiting. The unreviewed draft is not a result.',
  review_unavailable: 'The Reviewer could not be reached. The unreviewed draft is not a result.',
  model_unavailable: 'The provider did not return a Researcher draft.',
};

function at(value: string | null): string {
  if (value === null) return 'NEVER';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'UNKNOWN' : parsed.toLocaleString();
}

function permission(agent: AgentRecord): string {
  const reads = agent.permissions.read.length === 0 ? 'NO READS' : `READ ${agent.permissions.read.join(', ')}`;
  const writes = agent.permissions.write.length === 0 ? 'NO WRITES' : `WRITE ${agent.permissions.write.join(', ')}`;
  return `${reads} · ${writes}`;
}

export function Agents() {
  const scope = useScope();
  const { loaded: session } = useSession();
  const binding = session.state === 'ready' && session.value.signedIn ? session.value.session.binding : undefined;
  const agents = useScoped<readonly AgentRecord[]>('agents');
  const recommendations = useScoped<readonly AgentRecommendationRecord[]>('recommendations');
  const rows = agents.state === 'ready' ? agents.value : [];
  const suggested = recommendations.state === 'ready' ? recommendations.value : [];
  const researcher = rows.find((agent) => agent.role === 'RESEARCHER') ?? null;
  const [task, setTask] = useState('');
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [recommendationMessage, setRecommendationMessage] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<string | null>(null);
  // Preserve the id after a client timeout. The server may have finished the
  // run even when the response was lost, so retrying with the same id lets the
  // durable runtime return that exact run instead of starting another one.
  const pendingRequestId = useRef<string | null>(null);

  function useRecommendation(recommendation: AgentRecommendationRecord): void {
    if (busy) return;
    pendingRequestId.current = null;
    setTask(recommendation.task);
    setRun(null);
    setProblem(null);
    setRecommendationMessage(`${recommendation.name} task is ready below. Review it, then run it explicitly.`);
  }

  async function scheduleRecommendation(recommendation: AgentRecommendationRecord): Promise<void> {
    setScheduling(recommendation.id);
    setRecommendationMessage(null);
    try {
      const result = await guardedAction(
        () => postFor<DailyScheduleRecord>(
          `/api/workspace/agent/recommendations/${encodeURIComponent(recommendation.id)}/schedule`,
          {
            cadence: recommendation.suggestedSchedule.cadence,
            localTime: recommendation.suggestedSchedule.localTime,
            timezone: recommendation.suggestedSchedule.timezone,
          },
          15_000,
          binding,
        ),
        'The schedule was not created. Check the session and schedule controls.',
      );
      setRecommendationMessage(result.message ?? (result.value === null
        ? 'The schedule was not created.'
        : `${result.value.name} will run daily at ${result.value.localTime} ${result.value.timezone}. Nothing ran now.`));
    } finally {
      setScheduling(null);
    }
  }

  async function launch(): Promise<void> {
    if (researcher === null || task.trim() === '') return;
    const requestId = pendingRequestId.current ?? createClientUuid();
    pendingRequestId.current = requestId;
    setBusy(true);
    setProblem(null);
    try {
      const response = await postJson(
        `${scope.base}/agent/run`,
        { task, agentId: researcher.id, requestId },
        AGENT_REQUEST_TIMEOUT_MS,
        binding,
      );
      // A timeout or transport failure is ambiguous: retain the key so the
      // next click can safely replay it. All ordinary HTTP responses are
      // authoritative and start a fresh request on the next launch.
      if (response.status !== 408 && response.status !== 0) pendingRequestId.current = null;
      if (response.status === 429) setProblem('The run budget is busy. Try again after the current rate window.');
      else if (response.status === 401 || response.status === 403) setProblem('Permission required.');
      else if (response.status === 501) setProblem('No model provider is configured on this deployment.');
      else if (!response.ok || typeof response.body !== 'object' || response.body === null) {
        setProblem(response.status === 408 ? 'The run timed out before a reviewed result was available.' : 'The run did not complete.');
      } else setRun(response.body as AgentRunRecord);
    } catch {
      setProblem('Connection failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '28px' }}>
      <div>
        <div style={{ ...head, paddingBottom: '7px' }}>GOVERNED RUNTIME</div>
        <p style={{ fontSize: '15px', color: '#BDBDBD', margin: 0, maxWidth: '78ch', lineHeight: 1.65 }}>
          The Researcher gathers a bounded Context Pack from the existing resolver. The Reviewer
          receives compact facts and evidence, not a transcript, and rejects unsupported claims.
          Both roles are persisted per workspace and neither may write authoritative context.
        </p>
      </div>

      <section aria-labelledby="agent-recommendations" style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <div>
          <div id="agent-recommendations" style={{ ...head, paddingBottom: '7px', color: '#B79BFF' }}>SUGGESTED FROM THIS MEMORY</div>
          <p style={{ fontSize: '14px', color: '#9A9A9A', margin: 0, maxWidth: '76ch', lineHeight: 1.6 }}>
            These are read-only suggestions from resolved claim standings. Reading this page does not create an agent, start a run, or enable a schedule.
          </p>
        </div>
        {recommendations.state === 'loading' ? <Stage label="SCANNING RESOLVED MEMORY" /> : null}
        {recommendations.state === 'failed' ? <Failed reason={recommendations.reason} /> : null}
        {recommendations.state === 'ready' && suggested.length === 0 ? (
          <Empty headline="No agent suggestion yet." detail="Add current, revised, or conflicting evidence. Lacuna will suggest bounded work only when memory provides a reason." />
        ) : null}
        {suggested.map((recommendation) => (
          <article key={recommendation.id} style={{ border: '1px solid rgba(183,155,255,0.24)', borderRadius: '10px', padding: '17px', background: 'linear-gradient(110deg, rgba(128,82,255,0.08), rgba(128,82,255,0) 56%)', display: 'grid', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '18px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '17px', color: '#FFFFFF' }}>{recommendation.name}</div>
                <p style={{ margin: '7px 0 0', color: '#BDBDBD', fontSize: '13.5px', lineHeight: 1.6, maxWidth: '72ch' }}>{recommendation.reason}</p>
              </div>
              <span style={{ ...note, color: '#B79BFF', border: '1px solid rgba(183,155,255,0.34)', padding: '6px 8px' }}>{recommendation.kind.replaceAll('_', ' ')}</span>
            </div>
            <div aria-label="Recommendation path" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' }}>
              {[
                ['MEMORY SIGNAL', `${recommendation.evidence.length} resolved rows`],
                ['BOUNDED RUN', `${recommendation.flow.join(' → ')} · ${recommendation.budgets.maxWallMs / 1000}s`],
                ['SAFETY', `${recommendation.writeback} · ${recommendation.permissions.write.length} write grants`],
              ].map(([label, value]) => (
                <div key={label} style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '8px' }}>
                  <div style={head}>{label}</div>
                  <div style={{ ...note, color: '#BDBDBD', marginTop: '5px', letterSpacing: '0.08em' }}>{value}</div>
                </div>
              ))}
            </div>
            {recommendation.evidence.length === 0 ? null : (
              <details>
                <summary style={{ ...head, cursor: 'pointer' }}>WHY THIS WAS SUGGESTED</summary>
                <ul style={{ margin: '9px 0 0', paddingLeft: '18px', color: '#9A9A9A', fontSize: '12.5px', lineHeight: 1.7 }}>
                  {recommendation.evidence.map((evidence, index) => (
                    <li key={`${recommendation.id}-evidence-${index}`}>{evidence}</li>
                  ))}
                </ul>
              </details>
            )}
            <div style={{ display: 'flex', gap: '9px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="hv-text" disabled={busy} onClick={() => useRecommendation(recommendation)} style={{ ...note, background: 'none', border: '1px solid rgba(128,82,255,0.55)', color: busy ? '#7A7A7A' : '#FFFFFF', padding: '8px 11px', cursor: busy ? 'default' : 'pointer' }}>USE THIS TASK</button>
              {scope.demo ? (
                <span style={{ ...note, letterSpacing: '0.08em' }}>SIGN IN TO SCHEDULE · PREVIEW STAYS READ ONLY</span>
              ) : (
                <button disabled={scheduling !== null} onClick={() => void scheduleRecommendation(recommendation)} style={{ ...note, background: 'none', border: '1px solid rgba(255,255,255,0.16)', color: scheduling === recommendation.id ? '#7A7A7A' : '#BDBDBD', padding: '8px 11px', cursor: scheduling === null ? 'pointer' : 'default' }}>
                  {scheduling === recommendation.id ? 'CREATING SCHEDULE' : `SCHEDULE ${recommendation.suggestedSchedule.localTime} ${recommendation.suggestedSchedule.timezone}`}
                </button>
              )}
              <span style={{ ...note, letterSpacing: '0.08em' }}>{recommendation.suggestedSchedule.reason}</span>
            </div>
          </article>
        ))}
        {recommendationMessage === null ? null : <div aria-live="polite" style={{ fontSize: '13px', color: '#BDBDBD' }}>{recommendationMessage}</div>}
      </section>

      {agents.state === 'loading' ? <Stage label="LOADING AGENTS" /> : null}
      {agents.state === 'failed' ? <Failed reason={agents.reason} /> : null}
      {agents.state === 'ready' && rows.length === 0 ? (
        <Empty headline="No runtime agents exist." detail="Initialize the built-in Researcher and Reviewer for this workspace before launching work." />
      ) : null}

      {rows.map((agent) => (
        <article key={agent.id} style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '18px', display: 'flex', flexWrap: 'wrap', gap: '24px' }}>
          <div style={{ flex: '1 1 190px' }}>
            <div style={{ fontSize: '20px', color: '#FFFFFF' }}>{agent.name}</div>
            <div style={{ ...note, color: '#B79BFF', marginTop: '6px' }}>{agent.role}</div>
            <div style={{ ...note, marginTop: '15px' }}>{agent.provider} · {agent.model}</div>
            <div style={{ ...note, marginTop: '5px' }}>{agent.workspace}</div>
          </div>
          <div style={{ flex: '2 1 320px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '14px', color: '#BDBDBD', lineHeight: 1.6, margin: 0 }}>{agent.purpose}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr)', gap: '8px 16px', fontSize: '12px' }}>
              <span style={head}>CONTEXT</span><span style={{ color: '#9A9A9A' }}>{agent.contextPolicy}</span>
              <span style={head}>PERMISSIONS</span><span style={{ ...note, letterSpacing: '0.08em' }}>{permission(agent)}</span>
              <span style={head}>TOOLS</span><span style={{ ...note, letterSpacing: '0.08em' }}>{agent.tools.length === 0 ? 'NONE' : agent.tools.join(', ')}</span>
              <span style={head}>WRITEBACK</span><span style={{ ...note, letterSpacing: '0.08em' }}>{agent.writeback}</span>
              <span style={head}>BUDGET</span><span style={{ ...note, letterSpacing: '0.08em' }}>{agent.budgets.maxModelCalls} MODEL · {agent.budgets.maxToolCalls} TOOL · {agent.budgets.maxWallMs / 1000}S</span>
              <span style={head}>LAST RUN</span><span style={{ ...note, letterSpacing: '0.08em' }}>{agent.lastRun === null ? 'NEVER' : `${agent.lastRun.status} · ${at(agent.lastRun.at)}`}</span>
            </div>
          </div>
        </article>
      ))}

      {scope.demo && researcher !== null ? (
        <section style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '22px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
          <div style={head}>ACCEPTED RUN · READ ONLY</div>
          <p style={{ margin: 0, color: '#BDBDBD', fontSize: '13.5px', lineHeight: 1.65, maxWidth: '72ch' }}>
            This public proof workspace preserves the accepted Researcher → Reviewer run below.
            Sign in to create work inside an isolated workspace with CSRF protection and a durable run budget.
          </p>
        </section>
      ) : null}

      {researcher === null || scope.demo ? null : (
        <section style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={head}>RUN RESEARCHER → REVIEWER</div>
          <textarea
            aria-label="Agent task"
            value={task}
            onChange={(event) => {
              setTask(event.target.value);
              if (!busy) pendingRequestId.current = null;
            }}
            placeholder="Ask a task about a named subject in this workspace."
            rows={3}
            maxLength={600}
            disabled={busy}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', padding: '12px 13px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px', outline: 'none', resize: 'vertical', lineHeight: 1.6 }}
          />
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="hv-text"
              disabled={busy || task.trim() === ''}
              onClick={() => void launch()}
              style={{ background: 'none', cursor: busy ? 'default' : 'pointer', padding: '9px 15px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', border: '1px solid rgba(128,82,255,0.55)', color: busy ? '#7A7A7A' : '#FFFFFF' }}
            >
              {busy ? 'RUNNING' : 'RUN TASK'}
            </button>
            {problem === null ? null : <span style={{ fontSize: '13px', color: '#FFB829' }}>{problem}</span>}
          </div>
        </section>
      )}

      {run === null ? null : (
        <section aria-live="polite" style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
          <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', ...note }}>
            <span style={{ color: run.status === 'COMPLETED' ? '#B79BFF' : '#FFB829' }}>{run.status}</span>
            <span>{run.provider.name} · {run.provider.model}</span>
            <span>{run.timings.totalMs} MS</span>
            <span>{run.pack?.claims.length ?? 0} CLAIMS</span>
            <span>{run.writebackDecision.authoritativeMutation ? 'AUTHORITATIVE WRITE' : 'NO AUTHORITATIVE WRITE'}</span>
          </div>
          {run.error === null ? null : <p style={{ margin: 0, color: '#FFB829' }}>{ERROR_COPY[run.error] ?? `Run failed: ${run.error}.`}</p>}
          {run.result === null ? null : <p style={{ margin: 0, fontSize: '16px', lineHeight: 1.7, color: '#FFFFFF' }}>{run.result}</p>}
          {run.verdict !== null && !run.verdict.approved ? (
            <div style={{ borderLeft: '2px solid #FFB829', paddingLeft: '13px' }}>
              <div style={{ ...head, color: '#FFB829' }}>REVIEW REJECTED</div>
              {run.verdict.unsupported.map((claim) => <div key={claim} style={{ color: '#BDBDBD', marginTop: '7px' }}>{claim}</div>)}
            </div>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {run.events.map((event, index) => (
              <span key={`${event.at}-${index}`} style={{ ...note, border: '1px solid rgba(255,255,255,0.10)', padding: '6px 8px', color: event.stage === 'HANDOFF' ? '#B79BFF' : '#9A9A9A' }}>
                {event.stage}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
