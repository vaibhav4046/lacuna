
import { useScoped } from '../../api/scope';
import { hydraState, useHealth, UNCHECKED } from '../../api/health';
import type { HealthReport } from '../../api/health';
import { icStyle } from '../../design/icons';
import { MONO } from '../../design/mark';
import { Empty, Failed, Stage } from '../state';

/**
 * The PROOF group: Evaluations and HydraDB.
 *
 * These two screens exist to be checkable, so they are the last place a
 * number should appear without a run behind it. Evaluations reads recorded
 * artifacts and says NO MEASURED RUN when there are none. HydraDB reads the
 * same six checks `lacuna doctor` runs and prints the round trip it actually
 * measured.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;
const key = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#5E5E5E', paddingTop: '2px' } as const;

interface EvalRow {
  readonly method: string;
  readonly cases: string;
  readonly result: string;
}

const EVAL_GRID = '1fr 1fr 0.8fr';

export function Evaluations() {
  const rows = useScoped<readonly EvalRow[]>('evaluations');
  const list = rows.state === 'ready' ? rows.value : [];

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <p style={{ fontSize: '15.5px', lineHeight: 1.75, color: '#9A9A9A', margin: 0, maxWidth: '60ch' }}>Measure the context. Then make the claim. Failures are shown, not hidden.</p>
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: EVAL_GRID, gap: '16px', padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.14)', ...head }}>
          <span>METHOD</span><span>CASES</span><span>RESULT</span>
        </div>
        {rows.state === 'loading' ? <Stage label="RETRIEVING" /> : null}
        {rows.state === 'failed' ? <Failed reason={rows.reason} /> : null}
        {rows.state === 'ready' && list.length === 0 ? (
          <Empty headline="No recorded runs." detail="A row appears here when an evaluation writes an artifact. Nothing is filled in from an estimate." />
        ) : null}
        {list.map((e) => (
          <div key={e.method} className="hv-surface3" style={{ display: 'grid', gridTemplateColumns: EVAL_GRID, gap: '16px', alignItems: 'baseline', padding: '15px 4px', borderBottom: '1px solid rgba(255,255,255,0.07)', transition: 'background 140ms ease' }}>
            <span style={{ fontSize: '14.5px', color: '#FFFFFF' }}>{e.method}</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.08em', color: '#71717A' }}>{e.cases}</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E' }}>{e.result}</span>
          </div>
        ))}
      </div>
      <span style={{ ...note, lineHeight: 2 }}>COLUMNS WHEN REAL · CORRECTNESS · CONTEXT TOKENS · LATENCY · COST · ABSTENTION<br />SMALL VS LARGE MODEL PANEL FILLS ONLY FROM A RECORDED RUN</span>
    </div>
  );
}

/** The round trip the doctor measured, pulled out of its own detail line. */
function roundTripMs(report: HealthReport | null): string {
  if (report === null) return '—';
  const check = report.checks.find((c) => c.name === 'round trip');
  if (check === undefined || check.state === 'fail') return '—';
  // Any milliseconds the check reported, however the sentence around them is
  // worded: the node's doctor writes "in 12ms" and the cloud's writes
  // "ready for ingestion, 170ms", and both are the same measurement.
  const match = /([\d.]+)\s*ms/.exec(check.detail);
  return match?.[1] === undefined ? '—' : `${match[1]} ms`;
}

function configLine(report: HealthReport | null): string {
  if (report === null) return '—';
  const check = report.checks.find((c) => c.name === 'config');
  return check === undefined || check.state === 'fail' ? '—' : check.detail;
}

export function HydraDb() {
  const health = useHealth();
  const report = health.state === 'ready' ? health.value : null;
  const state = hydraState(health);

  return (
    <div style={{ maxWidth: '880px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
        <span style={icStyle('HydraDB', 15)}></span>
        <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.18em', color: '#BDBDBD' }}>HYDRADB · {state}</span>
        <span style={note}>SECRETS NEVER SHOWN</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '12px 26px', maxWidth: '620px', fontFamily: MONO }}>
        <span style={key}>ENDPOINT</span><span style={{ fontSize: '13px', color: '#BDBDBD' }}>{configLine(report)}</span>
        <span style={key}>RETRIEVAL</span><span style={{ fontSize: '13px', color: '#BDBDBD' }}>hybrid · graph context</span>
        <span style={key}>TEMPORAL</span><span style={{ fontSize: '13px', color: '#BDBDBD' }}>versioned state · history kept</span>
        <span style={key}>ROUND TRIP</span><span style={{ fontSize: '13px', color: '#9A9A9A' }}>{roundTripMs(report)}{roundTripMs(report) === '—' ? ' · measured after connection' : ' · measured'}</span>
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>CHECKS</span>
        {report === null ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>{state === UNCHECKED ? 'Nothing checked yet.' : 'The checks did not complete.'}</span>
        ) : report.checks.map((c) => (
          <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '18px', alignItems: 'baseline', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.1em', color: '#BDBDBD' }}>{c.name.toUpperCase()}</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: c.state === 'pass' ? '#15846E' : c.state === 'warn' ? '#FFB829' : '#9A9A9A' }}>{c.state.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
