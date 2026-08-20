import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useScope, useScoped } from '../../api/scope';
import { icStyle } from '../../design/icons';
import { MONO } from '../../design/mark';
import { dotFor } from '../../design/connectors';
import { Panel } from '../state';
import type { AgentRunRecord, DailyScheduleRecord } from '../agents/contracts';

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

const head = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.22em', color: '#7A7A7A', paddingBottom: '10px', borderBottom: '1px solid rgba(255,255,255,0.12)' } as const;
const headLater = { ...head, padding: '26px 0 10px', paddingBottom: '10px' } as const;
const rowMeta = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.1em', color: '#9A9A9A', flexShrink: 0 } as const;

export function Dashboard() {
  const go = useNavigate();
  const { prefix } = useScope();
  const [question, setQuestion] = useState('');
  const changes = useScoped<readonly Change[]>('changes');
  const conflicts = useScoped<readonly Conflict[]>('conflicts');
  const connections = useScoped<readonly Connection[]>('connections');
  const counts = useScoped<HealthCounts>('health');
  const runs = useScoped<readonly AgentRunRecord[]>('runs');
  const schedules = useScoped<readonly DailyScheduleRecord[]>('schedules');

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingBottom: '4px' }}>
        {([
          ['ADD CONTEXT', `${prefix}/memory`],
          ['ASK LACUNA', `${prefix}/ask`],
          ['RUN AGENT', `${prefix}/agents`],
          ['TALK TO LACUNA', `${prefix}/voice`],
          ['CONNECT MCP', `${prefix}/mcp`],
          ['OPEN CLI', `${prefix}/cli`],
        ] as const).map(([label, to]) => (
          <button
            key={label}
            className="hv-text"
            onClick={() => go(to)}
            style={{
              background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '9px 14px',
              fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em',
              border: `1px solid ${label === 'ADD CONTEXT' ? 'rgba(128,82,255,0.55)' : 'rgba(255,255,255,0.14)'}`,
              color: label === 'ADD CONTEXT' ? '#FFFFFF' : '#9A9A9A',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/*
        This was a button shaped exactly like a text field. Clicking anywhere on
        it went to the Ask screen, which is a reasonable thing to do and a poor
        thing to disguise: something that looks typeable should be typeable. It
        is a real field now, and the question it carries is run on arrival.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '15px 18px' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.2em', color: '#8052FF' }}>ASK</span>
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || question.trim() === '') return;
            go(`${prefix}/ask?q=${encodeURIComponent(question.trim())}`);
          }}
          placeholder="Ask Lacuna anything in this workspace…"
          aria-label="Ask a question about this workspace"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: '#FFFFFF', fontFamily: MONO, fontSize: '13px', outline: 'none' }}
        />
      </div>

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
              <button key={c.t} className="hv-surface3" onClick={() => go(`${prefix}/graph`)} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'baseline', padding: '13px 2px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'none', borderLeft: 'none', borderRight: 'none', borderTop: 'none', cursor: 'pointer', textAlign: 'left' }}>
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

          <button className="hv-surface3" onClick={() => go(`${prefix}/health`)} style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'baseline', padding: '13px 2px', borderTop: '1px solid rgba(255,255,255,0.12)', background: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.22em', color: '#7A7A7A' }}>CONTEXT HEALTH</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.08em', color: '#9A9A9A' }}>
              {counts.state === 'ready'
                ? `${counts.value.current} current · ${counts.value.historical} historical · ${counts.value.conflicts} conflict`
                : '—'}
            </span>
          </button>
        </div>
      </div>

      <section style={{ borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '40px' }}>
        <div>
          <span style={head}>RECENT AGENT RUNS</span>
          <Panel loaded={runs} stage="LOADING RUNS" empty={{ headline: 'Run your first agent.', detail: 'Researcher and Reviewer lifecycle records appear here after a governed run.' }}>
            {(rows) => rows.slice(0, 3).map((run) => (
              <button key={run.id} className="hv-surface3" onClick={() => go(`${prefix}/work`)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: '16px', padding: '13px 2px', border: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: '14px', color: '#FFFFFF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{run.task}</span>
                <span style={{ ...rowMeta, color: run.status === 'COMPLETED' ? '#B79BFF' : run.status === 'FAILED' || run.status === 'CANCELLED' ? '#FFB829' : '#BDBDBD' }}>{run.status}</span>
              </button>
            ))}
          </Panel>
        </div>
        <div>
          <span style={head}>NEXT SCHEDULED RUN</span>
          <Panel loaded={schedules} stage="LOADING SCHEDULE" empty={{ headline: 'No schedule configured.', detail: 'The daily Context Health schedule is created when this runtime becomes available.' }}>
            {(rows) => rows.slice(0, 1).map((schedule) => (
              <button key={schedule.id} className="hv-surface3" onClick={() => go(`${prefix}/work`)} style={{ width: '100%', display: 'grid', gap: '7px', padding: '13px 2px', border: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ fontSize: '14px', color: '#FFFFFF' }}>{schedule.name}</span>
                <span style={rowMeta}>DAILY · {schedule.localTime} {schedule.timezone} · {new Date(schedule.nextEligibleAt).toLocaleString()}</span>
                <span style={rowMeta}>LAST RUN · {schedule.lastRunAt === null ? 'NEVER' : new Date(schedule.lastRunAt).toLocaleString()} · RETRY {schedule.retry.state}</span>
              </button>
            ))}
          </Panel>
        </div>
      </section>
    </div>
  );
}
