import { useLoaded } from '../../api/client';
import { MONO } from '../../design/mark';
import { Empty, Failed, Stage } from '../state';

/**
 * The WORK group: Work, Agents and Tools.
 *
 * Nothing here is configured out of the box, and the screens say so rather
 * than listing four agents nobody created. The design's own line on the work
 * screen is the rule for all three: stages move only on real events.
 */

const chip = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', borderRadius: '7px', padding: '7px 11px' } as const;
const stage = { fontFamily: MONO, fontSize: '11px', letterSpacing: '0.18em', color: '#BDBDBD' } as const;
const rule = { width: '30px', height: '1px', background: 'rgba(255,255,255,0.16)' } as const;
const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;

const STAGES = ['REQUEST', 'CONTEXT', 'AGENT', 'TOOLS', 'OUTCOME', 'WRITEBACK'] as const;

export function Work() {
  const runs = useLoaded<readonly unknown[]>('/api/workspace/runs');

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ ...chip, border: '1px solid rgba(255,255,255,0.16)', color: '#FFFFFF' }}>ACTIVE</span>
        <span style={{ ...chip, border: '1px solid rgba(255,255,255,0.10)', color: '#71717A' }}>WAITING</span>
        <span style={{ ...chip, border: '1px solid rgba(255,255,255,0.10)', color: '#71717A' }}>COMPLETED</span>
        <span style={{ ...chip, border: '1px solid rgba(255,255,255,0.10)', color: '#71717A' }}>SCHEDULED</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        {STAGES.map((s, i) => (
          <span key={s} style={{ display: 'contents' }}>
            <span style={stage}>{s}</span>
            {i < STAGES.length - 1 ? <span style={rule}></span> : null}
          </span>
        ))}
      </div>
      {runs.state === 'loading' ? <Stage label="RETRIEVING" /> : null}
      {runs.state === 'failed' ? <Failed reason={runs.reason} /> : null}
      {runs.state === 'ready' && runs.value.length === 0 ? (
        <div style={{ padding: '70px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: '22px', color: '#FFFFFF', letterSpacing: '-0.01em' }}>No runs yet.</div>
          <p style={{ fontSize: '15px', color: '#9A9A9A', margin: 0, maxWidth: '44ch' }}>Work appears when an agent executes a task with a Context Pack.</p>
          <span style={{ ...note, letterSpacing: '0.18em', marginTop: '6px' }}>NO FAKE PROGRESS · STAGES MOVE ONLY ON REAL EVENTS</span>
        </div>
      ) : null}
    </div>
  );
}

interface Agent {
  readonly name: string;
  readonly role: string;
  readonly model: string;
  readonly tools: string;
  readonly state: string;
}

const AGENT_GRID = '1.2fr 0.9fr 1.1fr 0.8fr';

export function Agents() {
  const agents = useLoaded<readonly Agent[]>('/api/workspace/agents');
  const rows = agents.state === 'ready' ? agents.value : [];

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <p style={{ fontSize: '15.5px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '60ch' }}>No avatars. An agent is a role, a model, a tool set and a context scope.</p>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: AGENT_GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>AGENT</span><span>MODEL</span><span>TOOLS</span><span>STATE</span>
        </div>
        {agents.state === 'loading' ? <Stage label="RETRIEVING" /> : null}
        {agents.state === 'failed' ? <Failed reason={agents.reason} /> : null}
        {agents.state === 'ready' && rows.length === 0 ? (
          <Empty headline="No agents configured." detail="An agent is a role, a model and a tool set. Create one and it appears here." />
        ) : null}
        {rows.map((a) => (
          <div key={a.name} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: AGENT_GRID, gap: '16px', alignItems: 'baseline', padding: '16px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
            <div>
              <div style={{ fontSize: '15px', color: '#FFFFFF' }}>{a.name}</div>
              <div style={{ fontFamily: MONO, fontSize: '10.5px', color: '#9A9A9A', marginTop: '5px' }}>{a.role}</div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: '12px', color: '#BDBDBD' }}>{a.model}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{a.tools}</span>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>{a.state}</span>
          </div>
        ))}
        <div style={{ border: '1px dashed rgba(255,255,255,0.16)', borderRadius: '8px', padding: '16px', textAlign: 'center', marginTop: '18px', fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#5E5E5E' }}>+ NEW AGENT</div>
      </div>
    </div>
  );
}

interface Tool {
  readonly name: string;
  readonly kind: string;
  readonly conn: string;
  readonly dot: string;
  readonly perm: string;
  readonly acc: string;
  readonly last: string;
}

const TOOL_GRID = '1.3fr 1fr 0.9fr 0.9fr 0.6fr';

export function Tools() {
  const tools = useLoaded<readonly Tool[]>('/api/workspace/tools');
  const rows = tools.state === 'ready' ? tools.value : [];

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <p style={{ fontSize: '15.5px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '60ch' }}>Connections, permissions and access. Colour never carries the state alone.</p>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: TOOL_GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>TOOL</span><span>CONNECTION</span><span>PERMISSIONS</span><span>AGENT ACCESS</span><span>LAST RUN</span>
        </div>
        {tools.state === 'loading' ? <Stage label="CHECKING CONTEXT" /> : null}
        {tools.state === 'failed' ? <Failed reason={tools.reason} /> : null}
        {tools.state === 'ready' && rows.length === 0 ? (
          <Empty headline="No tools connected." detail="A tool is something an agent may call. Nothing is connected in this workspace." />
        ) : null}
        {rows.map((t) => (
          <div key={t.name} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: TOOL_GRID, gap: '16px', alignItems: 'baseline', padding: '15px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
            <div>
              <div style={{ fontFamily: MONO, fontSize: '13px', color: '#FFFFFF' }}>{t.name}</div>
              <div style={{ fontFamily: MONO, fontSize: '10px', color: '#5E5E5E', marginTop: '5px' }}>{t.kind}</div>
            </div>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: t.dot }}></span>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#BDBDBD' }}>{t.conn}</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{t.perm}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>{t.acc}</span>
            <span style={{ fontFamily: MONO, fontSize: '11px', color: '#5E5E5E' }}>{t.last}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
