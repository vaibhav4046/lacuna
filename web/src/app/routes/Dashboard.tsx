import { useNavigate } from 'react-router-dom';
import { useLoaded } from '../../api/client';
import { icStyle } from '../../design/icons';
import { MONO } from '../../design/mark';
import { dotFor } from '../../design/connectors';
import { Panel } from '../state';

/**
 * The dashboard.
 *
 * Every number and every row here is the workspace's, which on a new account
 * means every panel is empty. The design draws this screen full, with the
 * sample workspace's own values in it, and those values are a layout reference
 * rather than seed data: a person who has just signed up has not had anything
 * change, has no conflicts, and has connected nothing.
 */

interface Change {
  readonly t: string;
  readonly d: string;
}

interface Conflict {
  readonly t: string;
  readonly state: string;
}

interface Connection {
  readonly n: string;
  readonly st: string;
}

interface HealthCounts {
  readonly current: number;
  readonly historical: number;
  readonly conflicts: number;
}

const head = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.22em', color: '#5E5E5E', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.12)' } as const;
const headLater = { ...head, padding: '26px 0 10px', paddingBottom: '10px' } as const;
const rowMeta = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.1em', color: '#9A9A9A', flexShrink: 0 } as const;

export function Dashboard() {
  const go = useNavigate();
  const changes = useLoaded<readonly Change[]>('/api/workspace/changes');
  const conflicts = useLoaded<readonly Conflict[]>('/api/workspace/conflicts');
  const connections = useLoaded<readonly Connection[]>('/api/workspace/connections');
  const runs = useLoaded<readonly unknown[]>('/api/workspace/runs');
  const counts = useLoaded<HealthCounts>('/api/workspace/health');

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <button className="hv-edge30" onClick={() => go('/app/ask')} style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '15px 18px', background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.2em', color: '#8052FF' }}>ASK</span>
        <span style={{ fontFamily: MONO, fontSize: '13px', color: '#5E5E5E' }}>Ask Lacuna anything in this workspace…</span>
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '40px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={head}>WHAT CHANGED</span>
          <Panel loaded={changes} stage="RETRIEVING" empty={{ headline: 'Nothing has changed yet.', detail: 'Revisions appear when a source updates something this workspace already knew.' }}>
            {(rows) => rows.map((c) => (
              <div key={c.t} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'baseline', padding: '13px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: '14px', color: '#FFFFFF' }}>{c.t}</span>
                <span style={rowMeta}>{c.d}</span>
              </div>
            ))}
          </Panel>

          <span style={headLater}>OPEN CONFLICTS</span>
          <Panel loaded={conflicts} stage="CHECKING CURRENT STATE" empty={{ headline: 'No open conflicts.', detail: 'A conflict appears when two sources disagree and neither has been resolved.' }}>
            {(rows) => rows.map((c) => (
              <button key={c.t} className="hv-surface3" onClick={() => go('/app/graph')} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'baseline', padding: '13px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'none', borderLeft: 'none', borderRight: 'none', borderTop: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: '14px', color: '#FFFFFF' }}>{c.t}</span>
                <span style={{ ...rowMeta, color: '#BDBDBD' }}>{c.state}</span>
              </button>
            ))}
          </Panel>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={head}>CONNECTIONS</span>
          <Panel loaded={connections} stage="CHECKING CONTEXT" empty={{ headline: 'Nothing connected yet.', detail: 'Connect a source and its context arrives here.' }}>
            {(rows) => rows.map((c) => (
              <div key={c.n} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'center', padding: '12px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <span style={icStyle(c.n, 13)}></span>
                  <span style={{ fontSize: '14px', color: '#BDBDBD' }}>{c.n}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: dotFor(c.st) }}></span>
                  <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#9A9A9A' }}>{c.st}</span>
                </span>
              </div>
            ))}
          </Panel>

          <span style={headLater}>RECENT RUNS</span>
          <Panel loaded={runs} stage="RETRIEVING" empty={{ headline: 'No runs yet.', detail: 'Work appears when an agent executes a task.' }}>
            {() => null}
          </Panel>

          <button className="hv-surface3" onClick={() => go('/app/health')} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'baseline', padding: '13px 2px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.22em', color: '#5E5E5E' }}>CONTEXT HEALTH</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
              {counts.state === 'ready'
                ? `${counts.value.current} current · ${counts.value.historical} historical · ${counts.value.conflicts} conflict`
                : '—'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
