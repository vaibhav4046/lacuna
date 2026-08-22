import { useMemo, useRef, useState } from 'react';

import { getJson, postFor } from '../../api/client';
import { useScope, useScoped } from '../../api/scope';
import { useSession } from '../../api/session';
import { MONO } from '../../design/mark';
import type { AgentRecord, AgentRunRecord, DailyScheduleRecord, RunStatus } from '../agents/contracts';
import { Empty, Failed, Stage } from '../state';

export { Tools } from './tools';

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.13em', color: '#7A7A7A' } as const;
const ACTIVE: ReadonlySet<RunStatus> = new Set(['CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'HANDOFF']);
const AGENT_REQUEST_TIMEOUT_MS = 65_000;

function at(value: string | null): string {
  if (value === null) return 'NEVER';
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? 'UNKNOWN' : parsed.toLocaleString();
}

function tone(status: RunStatus): string {
  if (status === 'COMPLETED') return '#B79BFF';
  if (status === 'FAILED' || status === 'CANCELLED') return '#FFB829';
  return '#FFFFFF';
}

type Filter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

function includes(filter: Filter, status: RunStatus): boolean {
  return filter === 'ALL'
    || (filter === 'ACTIVE' && ACTIVE.has(status))
    || filter === status;
}

function RunDetail({ run, agentName, demo, binding, onChange }: {
  readonly run: AgentRunRecord;
  readonly agentName: string;
  readonly demo: boolean;
  readonly binding?: string | undefined;
  readonly onChange: (run: AgentRunRecord) => void;
}) {
  const [mutating, setMutating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function action(kind: 'cancel' | 'retry'): Promise<void> {
    setMutating(true);
    setProblem(null);
    const updated = await postFor<AgentRunRecord>(
      `/api/workspace/agent/runs/${encodeURIComponent(run.id)}/${kind}`,
      {},
      kind === 'retry' ? AGENT_REQUEST_TIMEOUT_MS : 15_000,
      binding,
    );
    if (updated === null) setProblem(`${kind === 'cancel' ? 'Cancellation' : 'Retry'} did not complete.`);
    else onChange(updated);
    setMutating(false);
  }

  return (
    <article style={{ borderTop: '1px solid rgba(255,255,255,0.14)', padding: '18px 0 4px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '16px', color: '#FFFFFF', lineHeight: 1.55 }}>{run.task}</div>
          <div style={{ ...note, marginTop: '6px' }}>{agentName} · {run.provider.name} / {run.provider.model} · ATTEMPT {run.attempt}</div>
        </div>
        <div style={{ ...note, color: tone(run.status), border: '1px solid rgba(255,255,255,0.14)', padding: '7px 9px' }}>{run.status}</div>
      </div>

      <div aria-label="Observed run lifecycle" style={{ display: 'flex', alignItems: 'center', gap: '7px', flexWrap: 'wrap' }}>
        {run.events.map((event, index) => (
          <span key={`${event.at}-${index}`} style={{ display: 'contents' }}>
            <span title={`${at(event.at)} · ${event.detail}`} style={{ ...note, color: event.stage === 'HANDOFF' ? '#B79BFF' : '#9A9A9A' }}>{event.stage}</span>
            {index === run.events.length - 1 ? null : <span style={{ width: '18px', height: '1px', background: 'rgba(255,255,255,0.16)' }} />}
          </span>
        ))}
      </div>

      {run.result === null ? null : <p style={{ fontSize: '14.5px', color: '#BDBDBD', lineHeight: 1.7, margin: 0 }}>{run.result}</p>}
      {run.error === null ? null : <p style={{ fontSize: '13px', color: '#FFB829', margin: 0 }}>Run error: {run.error}</p>}
      {run.verdict !== null && run.verdict.unsupported.length > 0 ? (
        <div style={{ borderLeft: '2px solid #FFB829', paddingLeft: '12px' }}>
          <div style={{ ...head, color: '#FFB829' }}>UNSUPPORTED IN REVIEW</div>
          {run.verdict.unsupported.map((claim) => <div key={claim} style={{ marginTop: '6px', color: '#BDBDBD', fontSize: '13px' }}>{claim}</div>)}
        </div>
      ) : null}

      <details>
        <summary style={{ ...head, cursor: 'pointer', padding: '8px 0' }}>RUN RECORD</summary>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(130px, .4fr) minmax(0, 1.6fr)', gap: '12px 18px', padding: '12px 0 8px', fontSize: '12.5px' }}>
          <span style={head}>CONTEXT PACK</span>
          <span style={{ color: '#BDBDBD' }}>{run.pack === null ? 'NOT COMPILED' : `${run.pack.id} · ${run.pack.claims.length} claims · ${run.pack.estimatedTokens} estimated tokens`}</span>
          <span style={head}>TOOLS</span>
          <span style={{ color: '#BDBDBD' }}>{run.toolEvents.length === 0 ? 'NONE CALLED' : run.toolEvents.map((event) => `${event.tool} · ${event.status} · ${event.calls} calls · ${event.ms === null || event.ms === undefined ? 'TIME NOT MEASURED' : `${event.ms}ms`}`).join('; ')}</span>
          <span style={head}>HANDOFF</span>
          <span style={{ color: '#BDBDBD' }}>{run.handoff === null ? 'NONE' : `${run.handoff.from} → ${run.handoff.to} · ${run.handoff.supportedFacts.length} supported facts · pack ${run.handoff.packId}`}</span>
          <span style={head}>EVIDENCE</span>
          <span style={{ color: '#BDBDBD' }}>{run.evidenceRefs.length === 0 ? 'NO QUOTED EVIDENCE' : run.evidenceRefs.map((ref) => `${ref.subject} ${ref.predicate}: “${ref.quote}”${ref.source === null ? '' : ` · ${ref.source}`}`).join(' | ')}</span>
          <span style={head}>CONFLICTS</span>
          <span style={{ color: '#BDBDBD' }}>{run.conflicts.length === 0 ? 'NONE RETURNED' : run.conflicts.join('; ')}</span>
          <span style={head}>OPEN QUESTIONS</span>
          <span style={{ color: '#BDBDBD' }}>{run.openQuestions.length === 0 ? 'NONE RETURNED' : run.openQuestions.join('; ')}</span>
          <span style={head}>WRITEBACK</span>
          <span style={{ color: '#BDBDBD' }}>{run.writebackDecision.policy} · {run.writebackDecision.decision} · {run.writebackDecision.reason}</span>
          <span style={head}>TIMINGS</span>
          <span style={{ ...note, letterSpacing: '0.08em' }}>CONTEXT {run.timings.contextMs ?? '—'} · RESEARCHER {run.timings.researcherMs ?? '—'} · REVIEWER {run.timings.reviewerMs ?? '—'} · TOTAL {run.timings.totalMs} MS</span>
          <span style={head}>TRACE</span>
          <span style={{ color: '#9A9A9A' }}>{run.trace.map((entry) => `${entry.kind}: ${entry.detail}`).join(' · ')}</span>
        </div>
      </details>

      {demo ? null : (
        <div style={{ display: 'flex', gap: '9px', alignItems: 'center', flexWrap: 'wrap' }}>
          {ACTIVE.has(run.status) ? (
            <button disabled={mutating} onClick={() => void action('cancel')} style={{ ...note, background: 'none', border: '1px solid rgba(255,184,41,0.45)', color: '#FFB829', padding: '7px 10px', cursor: 'pointer' }}>CANCEL</button>
          ) : null}
          {run.status === 'FAILED' || run.status === 'CANCELLED' ? (
            <button disabled={mutating} onClick={() => void action('retry')} style={{ ...note, background: 'none', border: '1px solid rgba(128,82,255,0.55)', color: '#FFFFFF', padding: '7px 10px', cursor: 'pointer' }}>RETRY</button>
          ) : null}
          {problem === null ? null : <span style={{ color: '#FFB829', fontSize: '12px' }}>{problem}</span>}
        </div>
      )}
    </article>
  );
}

function Schedules({ demo, binding, onRun }: { readonly demo: boolean; readonly binding?: string | undefined; readonly onRun: (run: AgentRunRecord) => void }) {
  const schedules = useScoped<readonly DailyScheduleRecord[]>('schedules');
  const rows = schedules.state === 'ready' ? schedules.value : [];
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pendingRequests = useRef(new Map<string, string>());

  async function runNow(schedule: DailyScheduleRecord): Promise<void> {
    setWorking(schedule.id);
    setMessage(null);
    const requestId = pendingRequests.current.get(schedule.id) ?? `ui-${crypto.randomUUID()}`;
    pendingRequests.current.set(schedule.id, requestId);
    const result = await postFor<{ readonly outcome: string; readonly runId: string | null }>(
      `/api/workspace/schedules/${encodeURIComponent(schedule.id)}/run`,
      { requestId },
      AGENT_REQUEST_TIMEOUT_MS,
      binding,
    );
    if (result !== null) pendingRequests.current.delete(schedule.id);
    if (result?.runId !== null && result?.runId !== undefined) {
      try {
        const current = await getJson<readonly AgentRunRecord[]>('/api/workspace/runs', new AbortController().signal);
        const completed = current.find((run) => run.id === result.runId);
        if (completed !== undefined) onRun(completed);
      } catch {
        // The run id remains in the success message. A failed refresh does not
        // turn a completed dispatch into a reported failure.
      }
    }
    setMessage(result === null ? 'Run now did not complete.' : `${result.outcome}${result.runId === null ? '' : ` · ${result.runId}`}`);
    setWorking(null);
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={head}>SCHEDULES · DAILY IS THE SUPPORTED CADENCE</div>
      {schedules.state === 'loading' ? <Stage label="LOADING SCHEDULES" /> : null}
      {schedules.state === 'failed' ? <Failed reason={schedules.reason} /> : null}
      {schedules.state === 'ready' && rows.length === 0 ? (
        <Empty headline="No schedules configured." detail="The daily dispatcher has no schedule for this workspace." />
      ) : null}
      {rows.map((schedule) => (
        <div key={schedule.id} style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '13px', display: 'flex', justifyContent: 'space-between', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: '#FFFFFF', fontSize: '14.5px' }}>{schedule.name}</div>
            <div style={{ ...note, marginTop: '6px' }}>DAILY · {schedule.localTime} {schedule.timezone} · NEXT {at(schedule.nextEligibleAt)}</div>
            <div style={{ ...note, marginTop: '4px' }}>LAST {at(schedule.lastRunAt)} · RETRY {schedule.retry.state} ({schedule.retry.attempts})</div>
            <div style={{ marginTop: '7px', color: '#9A9A9A', fontSize: '12px', lineHeight: 1.55, maxWidth: '72ch' }}>{schedule.task}</div>
            <div style={{ ...note, marginTop: '5px', color: '#B79BFF' }}>RESEARCHER → REVIEWER · NO AUTHORITATIVE WRITE</div>
          </div>
          {demo ? null : <button disabled={working !== null} onClick={() => void runNow(schedule)} style={{ ...note, alignSelf: 'flex-start', background: 'none', border: '1px solid rgba(128,82,255,0.55)', color: working === schedule.id ? '#7A7A7A' : '#FFFFFF', padding: '8px 11px', cursor: working === null ? 'pointer' : 'default' }}>{working === schedule.id ? 'RUNNING NOW' : 'RUN NOW'}</button>}
        </div>
      ))}
      {message === null ? null : <div aria-live="polite" style={{ ...note, color: '#BDBDBD' }}>{message}</div>}
    </section>
  );
}

export function Work() {
  const scope = useScope();
  const { loaded: session } = useSession();
  const binding = session.state === 'ready' && session.value.signedIn ? session.value.session.binding : undefined;
  const loadedRuns = useScoped<readonly AgentRunRecord[]>('runs');
  const loadedAgents = useScoped<readonly AgentRecord[]>('agents');
  const [changedRuns, setChangedRuns] = useState<readonly AgentRunRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');

  const agents = loadedAgents.state === 'ready' ? loadedAgents.value : [];
  const names = useMemo(() => new Map(agents.map((agent) => [agent.id, agent.name])), [agents]);
  const persistedRuns = loadedRuns.state === 'ready' ? loadedRuns.value : [];
  const changedIds = new Set(changedRuns.map((run) => run.id));
  const runs = [...changedRuns, ...persistedRuns.filter((run) => !changedIds.has(run.id))];
  const visible = runs.filter((run) => includes(filter, run.status));
  const filters: readonly Filter[] = ['ALL', 'ACTIVE', 'COMPLETED', 'FAILED', 'CANCELLED'];

  function replace(updated: AgentRunRecord): void {
    setChangedRuns((current) => [updated, ...current.filter((run) => run.id !== updated.id)]);
  }

  return (
    <div style={{ maxWidth: '1040px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px' }}>
      <Schedules demo={scope.demo} binding={binding} onRun={replace} />
      <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={head}>AGENT RUNS · OBSERVED EVENTS ONLY</div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {filters.map((value) => {
            const count = runs.filter((run) => includes(value, run.status)).length;
            return <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ ...note, background: 'none', border: `1px solid ${filter === value ? 'rgba(128,82,255,0.65)' : 'rgba(255,255,255,0.12)'}`, color: filter === value ? '#FFFFFF' : '#7A7A7A', padding: '7px 10px', cursor: 'pointer' }}>{value} · {count}</button>;
          })}
        </div>
        {loadedRuns.state === 'loading' ? <Stage label="LOADING RUNS" /> : null}
        {loadedRuns.state === 'failed' ? <Failed reason={loadedRuns.reason} /> : null}
        {loadedRuns.state === 'ready' && runs.length === 0 ? (
          <Empty headline="Run your first agent." detail="Launch a Researcher task from Agents. Its persisted lifecycle, handoff and evidence will appear here." />
        ) : null}
        {loadedRuns.state === 'ready' && runs.length > 0 && visible.length === 0 ? (
          <Empty headline={`No ${filter.toLowerCase()} runs.`} detail="Choose another status to inspect the runs this workspace has recorded." />
        ) : null}
        {visible.map((run) => <RunDetail key={run.id} run={run} agentName={names.get(run.agentId) ?? run.agentId} demo={scope.demo} binding={binding} onChange={replace} />)}
      </section>
    </div>
  );
}
