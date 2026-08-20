import { useState } from 'react';

import { csrfHeaders } from '../../api/client';
import { useScope, useScoped } from '../../api/scope';
import { MONO } from '../../design/mark';
import type { AgentRecord, AgentRunRecord } from '../agents/contracts';
import { Empty, Failed, Stage } from '../state';

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#7A7A7A' } as const;

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
  const agents = useScoped<readonly AgentRecord[]>('agents');
  const rows = agents.state === 'ready' ? agents.value : [];
  const researcher = rows.find((agent) => agent.role === 'RESEARCHER') ?? null;
  const [task, setTask] = useState('');
  const [run, setRun] = useState<AgentRunRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function launch(): Promise<void> {
    if (researcher === null || task.trim() === '') return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch(`${scope.base}/agent/run`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(scope.demo ? {} : csrfHeaders()) },
        body: JSON.stringify({ task, agentId: researcher.id }),
      });
      if (response.status === 429) setProblem('The run budget is busy. Try again after the current rate window.');
      else if (response.status === 401 || response.status === 403) setProblem('Permission required.');
      else if (response.status === 501) setProblem('No model provider is configured on this deployment.');
      else if (!response.ok) setProblem('The run did not complete.');
      else setRun(await response.json() as AgentRunRecord);
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

      {researcher === null ? null : (
        <section style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '22px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={head}>RUN RESEARCHER → REVIEWER</div>
          <textarea
            aria-label="Agent task"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Ask a task about a named subject in this workspace."
            rows={3}
            maxLength={600}
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
