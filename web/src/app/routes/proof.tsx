
import { useEffect, useState } from 'react';
import { useScope, useScoped } from '../../api/scope';
import { hydraState, useHealth, UNCHECKED } from '../../api/health';
import type { HealthReport } from '../../api/health';
import { ProofGraph } from '../../canvas/ProofGraph';
import { icStyle } from '../../design/icons';
import { getJson, useLoaded, type Loaded } from '../../api/client';
import { MONO } from '../../design/mark';
import { useGraph } from '../../graph/useGraph';
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

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;
const key = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A', paddingTop: '2px' } as const;

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
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.08em', color: '#7A7A84' }}>{e.cases}</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A' }}>{e.result}</span>
          </div>
        ))}
      </div>
      <LongMemEval />
      <span style={{ ...note, lineHeight: 2 }}>COLUMNS WHEN REAL · CORRECTNESS · CONTEXT TOKENS · LATENCY · COST · ABSTENTION<br />SMALL VS LARGE MODEL PANEL FILLS ONLY FROM A RECORDED RUN</span>
    </div>
  );
}

interface IngestCheck {
  readonly available: boolean;
  readonly instances?: number;
  readonly sessions?: number;
  readonly messages?: number;
  readonly estimatedTokens?: number;
  readonly parseFailures?: readonly unknown[];
  readonly adapterFailures?: number;
  readonly groundTruthLeaks?: number;
  readonly claims?: number;
  readonly instancesWithAtLeastOneClaim?: number;
  readonly coverage?: number;
  readonly bySlot?: Readonly<Record<string, number>>;
  readonly measuredAt?: string;
}

/**
 * The published LongMemEval file, and how far this extractor got through it.
 *
 * There is no score here on purpose. The extractor reads sentence frames about
 * infrastructure and LongMemEval is a personal assistant benchmark about
 * degrees, hobbies and appointments, so it produced a claim for 80 of the 500
 * instances. A correctness number computed over a sixth of a dataset is not a
 * result, it is a number chosen by whatever happened to parse, and reporting it
 * beside the honest ones would poison all of them.
 *
 * What is worth stating is what was measured. The published format read without
 * a parse failure, no ground truth survived the strip, and the coverage is
 * printed at its real value with the breakdown that explains it.
 */
function LongMemEval() {
  const run = useScoped<IngestCheck>('longmemeval');
  if (run.state !== 'ready' || !run.value.available) return null;
  const it = run.value;
  const clean = (it.parseFailures?.length ?? 0) === 0 && (it.adapterFailures ?? 0) === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.14)', paddingTop: '20px' }}>
      <div style={{ ...head }}>LONGMEMEVAL · NO SCORE, AND WHY</div>
      <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#BDBDBD', margin: 0, maxWidth: '68ch' }}>
        The published dataset was read through this repository&rsquo;s own adapter. It is a personal
        assistant benchmark about degrees, hobbies and appointments; this extractor reads sentence
        frames about infrastructure. So it found a claim in {it.instancesWithAtLeastOneClaim ?? 0} of
        the {it.instances ?? 0} instances, and a correctness figure over that slice would be chosen
        by whatever happened to parse rather than measured.
      </p>
      <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '11px', color: '#9A9A9A' }}>
        <span>{it.instances ?? 0} INSTANCES · {it.sessions ?? 0} SESSIONS · {it.messages ?? 0} MESSAGES</span>
        <span style={{ color: clean ? '#8052FF' : '#FFB829' }}>
          {clean ? 'READ WITH NO PARSE FAILURE' : `${it.parseFailures?.length ?? 0} PARSE FAILURES`}
        </span>
        <span style={{ color: (it.groundTruthLeaks ?? 1) === 0 ? '#8052FF' : '#FFB829' }}>
          {(it.groundTruthLeaks ?? 1) === 0 ? 'NO GROUND TRUTH LEAKED' : `${it.groundTruthLeaks} LEAKS`}
        </span>
        <span style={{ color: '#FFB829' }}>COVERAGE {it.coverage ?? 0}%</span>
      </div>
      {it.bySlot === undefined ? null : (
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.1em', color: '#7A7A7A' }}>
          {Object.entries(it.bySlot).map(([slot, count]) => (
            <span key={slot}>{slot.replace(/_/g, ' ')} {count}</span>
          ))}
        </div>
      )}
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

interface ServiceRelationRow {
  /** The store's own id for the edge. Null where the response omitted one. */
  readonly id: string | null;
  readonly source: string | null;
  readonly target: string | null;
  readonly predicate: string | null;
  readonly confidence: number | null;
  readonly context: string | null;
}

interface RelationsReply {
  readonly available: boolean;
  readonly reason?: string;
  readonly ms?: number;
  readonly relations: readonly ServiceRelationRow[];
}

/** A row of the store's own walk, with what Lacuna's claim graph says about it. */
interface ExpansionRow extends ServiceRelationRow {
  readonly standing: 'current' | 'historical' | 'contradicted' | 'withdrawn' | 'unstated';
}

interface ExpansionReply {
  readonly available: boolean;
  readonly reason?: string;
  readonly ms?: number;
  readonly subject: string | null;
  readonly relations: readonly ExpansionRow[];
}

const STANDING_COLOUR: Readonly<Record<ExpansionRow['standing'], string>> = {
  current: '#15846E',
  historical: '#FFB829',
  contradicted: '#FFB829',
  withdrawn: '#9A9A9A',
  unstated: '#7A7A7A',
};

const STANDING_LABEL: Readonly<Record<ExpansionRow['standing'], string>> = {
  current: 'STANDS',
  historical: 'REPLACED',
  contradicted: 'DISPUTED',
  withdrawn: 'WITHDRAWN',
  unstated: 'NOT A CLAIM',
};


/**
 * Eight rows that between them show every standing the walk produced.
 *
 * Taking the first eight hid the point: the walk returns its edges grouped, so
 * the rows that read NOT A CLAIM sat past the cut and a reader saw only the
 * dependency edges. This takes one of each standing first, then fills.
 */
function representative(rows: readonly ExpansionRow[]): readonly ExpansionRow[] {
  const seen = new Set<string>();
  const first: ExpansionRow[] = [];
  const rest: ExpansionRow[] = [];
  for (const row of rows) {
    if (seen.has(row.standing)) rest.push(row);
    else {
      seen.add(row.standing);
      first.push(row);
    }
  }
  return [...first, ...rest].slice(0, 8);
}


interface ImpactEdge {
  readonly source: string;
  readonly target: string;
  readonly predicate: string;
  readonly context: string | null;
  readonly depth: number;
}

interface RejectedEdge extends Omit<ImpactEdge, 'depth'> {
  readonly reason: 'historical' | 'contradicted' | 'unstated' | 'not_structural';
}

interface ImpactReply {
  readonly available: boolean;
  readonly reason?: string;
  readonly subject: string | null;
  readonly reached?: number;
  readonly accepted?: readonly ImpactEdge[];
  readonly rejected?: readonly RejectedEdge[];
  readonly duplicates?: number;
  readonly affected?: readonly string[];
  readonly depth?: number;
  readonly ms?: number;
}

interface PrivateImpactEndpoint {
  readonly raw: string | null;
  readonly display: string | null;
  readonly key: string | null;
}

interface PrivateImpactEdge {
  readonly outcome: string;
  readonly reason: string | null;
  readonly depth: number;
  readonly source: PrivateImpactEndpoint;
  readonly target: PrivateImpactEndpoint;
  readonly rawPredicate: string | null;
  readonly predicate: string | null;
  readonly direction: string;
  readonly context: string | null;
  readonly provenanceJoin: string;
  readonly sourceIds: readonly string[];
  readonly claimId: number | null;
}

interface PrivateImpactReply {
  readonly available: boolean;
  readonly reason?: string;
  readonly subject: string;
  readonly reached?: number;
  readonly accepted?: readonly PrivateImpactEdge[];
  readonly rejected?: readonly PrivateImpactEdge[];
  readonly duplicates?: number;
  readonly affected?: readonly PrivateImpactEndpoint[];
  readonly depth?: number;
  readonly ms?: number;
}

type PrivateImpactLoaded = Loaded<PrivateImpactReply> | { readonly state: 'idle' };

function usePrivateImpact(base: string, subject: string): PrivateImpactLoaded {
  const [loaded, setLoaded] = useState<PrivateImpactLoaded>({ state: 'idle' });
  useEffect(() => {
    const value = subject.trim();
    if (value === '') {
      setLoaded({ state: 'idle' });
      return;
    }
    const control = new AbortController();
    setLoaded({ state: 'loading' });
    getJson<PrivateImpactReply>(`${base}/impact?subject=${encodeURIComponent(value)}`, control.signal).then(
      (result) => {
        if (!control.signal.aborted) setLoaded({ state: 'ready', value: result });
      },
      () => {
        if (!control.signal.aborted) setLoaded({ state: 'failed', reason: 'Connection failed.' });
      },
    );
    return () => control.abort();
  }, [base, subject]);
  return loaded;
}

function privateEndpoint(endpoint: PrivateImpactEndpoint): string {
  return endpoint.display ?? endpoint.raw ?? 'unnamed';
}

function PrivateGraphImpact() {
  const { base } = useScope();
  const [draft, setDraft] = useState('');
  const [subject, setSubject] = useState('');
  const impact = usePrivateImpact(base, subject);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubject(draft.trim());
  };

  const rejected = impact.state === 'ready' ? (impact.value.rejected ?? []) : [];
  const accepted = impact.state === 'ready' ? (impact.value.accepted ?? []) : [];
  const it = impact.state === 'ready' ? impact.value : null;

  return (
    <>
      <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '68ch', lineHeight: 1.7 }}>
        HydraDB supplies bounded candidate relations from this private memory. Lacuna then
        evaluates current standing from the authenticated claim and Mention rows; the store
        never decides temporal truth on its own.
      </span>
      <form onSubmit={submit} style={{ display: 'flex', gap: '10px', alignItems: 'stretch', maxWidth: '680px' }}>
        <label htmlFor="private-impact-subject" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Subject for private impact
        </label>
        <input
          id="private-impact-subject"
          value={draft}
          maxLength={160}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Subject to trace"
          autoComplete="off"
          style={{ flex: 1, minWidth: 0, border: '1px solid rgba(255,255,255,0.16)', borderRadius: '7px', background: 'transparent', color: '#FFFFFF', padding: '10px 12px', fontFamily: MONO, fontSize: '11px' }}
        />
        <button type="submit" disabled={draft.trim() === ''} style={{ border: '1px solid rgba(128,82,255,0.7)', borderRadius: '7px', background: 'rgba(128,82,255,0.16)', color: '#FFFFFF', padding: '0 14px', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em' }}>
          TRACE
        </button>
      </form>

      {impact.state === 'idle' ? (
        <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Enter a subject to trace its private dependency impact.</span>
      ) : impact.state === 'loading' ? (
        <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Reading private memory.</span>
      ) : impact.state === 'failed' ? (
        <span style={{ fontSize: '14px', color: '#9A9A9A' }}>{impact.reason}</span>
      ) : !impact.value.available ? (
        <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Private impact is unavailable right now.</span>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', paddingTop: '2px' }}>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#8052FF' }}>{accepted.length} ACCEPTED</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' }}>{rejected.length} POLICY REJECTIONS</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' }}>{it?.duplicates ?? 0} DUPLICATES</span>
            <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' }}>{it?.reached ?? 0} REACHED</span>
          </div>
          <div style={{ padding: '12px 0' }}>
            <span style={{ fontSize: '17px', color: '#FFFFFF' }}>
              {(it?.affected ?? []).length === 0 ? 'Nothing currently depends on it.' : (it?.affected ?? []).map(privateEndpoint).join(', ')}
            </span>
            <div style={{ ...note, letterSpacing: '0.14em', paddingTop: '6px' }}>
              AFFECTED AT DEPTH {it?.depth ?? 0} · COMPUTED IN {it?.ms ?? 0} MS
            </div>
          </div>
          {accepted.map((edge, index) => (
            <div key={`private-a-${index}`} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 0', fontFamily: MONO, fontSize: '12px' }}>
              <span style={{ color: '#7A7A7A' }}>D{edge.depth}</span>
              <span style={{ color: '#FFFFFF' }}>{privateEndpoint(edge.source)}</span>
              <span style={{ color: '#8052FF' }}>{edge.predicate ?? edge.rawPredicate ?? 'depends_on'}</span>
              <span style={{ color: '#FFFFFF' }}>{privateEndpoint(edge.target)}</span>
              <span style={{ color: '#8052FF', fontSize: '10px', letterSpacing: '0.14em' }}>ACCEPTED · {edge.provenanceJoin}</span>
            </div>
          ))}
          {rejected.slice(0, 6).map((edge, index) => (
            <div key={`private-r-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '7px 0', opacity: 0.7 }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontFamily: MONO, fontSize: '12px' }}>
                <span style={{ color: '#BDBDBD' }}>{privateEndpoint(edge.source)}</span>
                <span style={{ color: '#7A7A84' }}>{edge.rawPredicate ?? 'relation'}</span>
                <span style={{ color: '#BDBDBD' }}>{privateEndpoint(edge.target)}</span>
                <span style={{ color: '#FFB829', fontSize: '10px', letterSpacing: '0.14em' }}>{edge.outcome.toUpperCase()}</span>
              </div>
              {edge.context === null ? null : <span style={{ fontSize: '12.5px', color: '#7A7A7A', lineHeight: 1.6, maxWidth: '70ch' }}>{edge.context}</span>}
            </div>
          ))}
        </>
      )}
    </>
  );
}

const REJECTION_LABEL: Readonly<Record<RejectedEdge['reason'], string>> = {
  historical: 'REPLACED',
  contradicted: 'DISPUTED',
  unstated: 'NOT A CLAIM',
  not_structural: 'NOT A DEPENDENCY',
};

/**
 * The one answer the store's graph decides.
 *
 * Everything else on this screen sets HydraDB's graph beside Lacuna's. This
 * computes a result out of it: the store's traversal supplies every candidate
 * edge, this project's policy removes the ones the conversation replaced,
 * disputed or never asserted, and what is reachable over the remainder is the
 * answer. Both halves are shown, because a filter nobody can see is a claim.
 */
function GraphImpact() {
  const { demo } = useScope();
  if (!demo) return <PrivateGraphImpact />;

  const impact = useLoaded<ImpactReply>('/api/explore/impact');

  if (impact.state !== 'ready') {
    return <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Computing over the store&rsquo;s graph.</span>;
  }
  if (!impact.value.available || impact.value.accepted === undefined) {
    return <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Not available: {impact.value.reason}.</span>;
  }

  const it = impact.value;
  const rejected = it.rejected ?? [];
  const byReason = new Map<RejectedEdge['reason'], number>();
  for (const edge of rejected) byReason.set(edge.reason, (byReason.get(edge.reason) ?? 0) + 1);

  return (
    <>
      <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '62ch', lineHeight: 1.7 }}>
        HydraDB traversed its own graph for <span style={{ color: '#FFFFFF' }}>{it.subject}</span> and
        returned <span style={{ color: '#FFFFFF' }}>{it.reached}</span> candidate edges. It has no way
        to know which of them the conversation later replaced, disputed, or never asserted, so this
        project&rsquo;s policy decides that and the reachable set is computed over what survives.
        Every rejection is below with its reason and the store&rsquo;s own sentence.
      </span>

      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', paddingTop: '2px' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#8052FF' }}>
          {(it.accepted ?? []).length} CROSSED
        </span>
        {[...byReason.entries()].map(([reason, n]) => (
          <span key={reason} style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' }}>
            {n} {REJECTION_LABEL[reason]}
          </span>
        ))}
        {it.duplicates === undefined || it.duplicates === 0 ? null : (
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: '#7A7A7A' }}>
            {it.duplicates} DUPLICATE
          </span>
        )}
      </div>

      <div style={{ padding: '12px 0' }}>
        <span style={{ fontSize: '17px', color: '#FFFFFF' }}>
          {(it.affected ?? []).length === 0
            ? 'Nothing current depends on it.'
            : `${(it.affected ?? []).join(', ')}`}
        </span>
        <div style={{ ...note, letterSpacing: '0.14em', paddingTop: '6px' }}>
          AFFECTED AT DEPTH {it.depth} · COMPUTED IN {it.ms} MS
        </div>
      </div>

      {(it.accepted ?? []).map((edge, i) => (
        <div key={`a${i}`} style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', padding: '7px 0', fontFamily: MONO, fontSize: '12px' }}>
          <span style={{ color: '#7A7A7A' }}>D{edge.depth}</span>
          <span style={{ color: '#FFFFFF' }}>{edge.source}</span>
          <span style={{ color: '#8052FF' }}>{edge.predicate}</span>
          <span style={{ color: '#FFFFFF' }}>{edge.target}</span>
          <span style={{ color: '#8052FF', fontSize: '10px', letterSpacing: '0.14em' }}>CROSSED</span>
        </div>
      ))}

      {rejected.filter((edge) => edge.reason !== 'not_structural').slice(0, 3).map((edge, i) => (
        <div key={`r${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '7px 0', opacity: 0.7 }}>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontFamily: MONO, fontSize: '12px' }}>
            <span style={{ color: '#BDBDBD' }}>{edge.source}</span>
            <span style={{ color: '#7A7A84' }}>{edge.predicate}</span>
            <span style={{ color: '#BDBDBD' }}>{edge.target}</span>
            <span style={{ color: '#FFB829', fontSize: '10px', letterSpacing: '0.14em' }}>{REJECTION_LABEL[edge.reason]}</span>
          </div>
          {edge.context === null ? null : (
            <span style={{ fontSize: '12.5px', color: '#7A7A7A', lineHeight: 1.6, maxWidth: '70ch' }}>{edge.context}</span>
          )}
        </div>
      ))}
    </>
  );
}

export function HydraDb() {
  const { prefix } = useScope();
  const health = useHealth();
  const relations = useScoped<RelationsReply>('relations');
  const expansion = useScoped<ExpansionReply>('expansion');
  const graph = useGraph('proof', 160);
  const report = health.state === 'ready' ? health.value : null;
  const state = hydraState(health);

  return (
    <div style={{ maxWidth: '1220px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '26px' }}>
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
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '22px' }}>
        {graph.loaded.state === 'loading' ? <Stage label="RETRIEVING PROOF GRAPH" /> : null}
        {graph.loaded.state === 'failed' ? <Failed reason={graph.loaded.reason} /> : null}
        {graph.loaded.state === 'ready' && graph.loaded.value.nodes.length === 0
          ? <Empty headline="No provenance path to draw." detail="A proof graph appears when this workspace has a claim or a recorded source. Missing evidence remains visible as a missing state." />
          : null}
        {graph.loaded.state === 'ready' && graph.loaded.value.nodes.length > 0
          ? <ProofGraph graph={graph.loaded.value} prefix={prefix} loadingMore={graph.loadingMore} moreFailed={graph.moreFailed} onLoadMore={graph.loadMore} />
          : null}
      </div>
      {/* HydraDB's own graph, not this product's.
          Every other screen shows what Lacuna traversed. This one asks the
          store what it found on its own: it read the same transcripts at
          ingest and extracted these relations from the prose, with the
          sentence it read each one out of. Showing both is the honest way to
          say what the store contributes and what the product adds. */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>RELATIONS HYDRADB EXTRACTED ITSELF</span>
        {relations.state !== 'ready' ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Reading the store.</span>
        ) : !relations.value.available ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>
            Not available: {relations.value.reason}.
          </span>
        ) : relations.value.relations.length === 0 ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>The store answered and returned no relations.</span>
        ) : (
          <>
            <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '62ch', lineHeight: 1.7 }}>
              The store was given the transcripts and found these on its own. Lacuna's claim
              graph is built from annotations at ingest, so this is what HydraDB adds rather
              than a second view of the same thing.
            </span>
            {relations.value.relations.slice(0, 8).map((r, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '12px' }}>
                  <span style={{ color: '#FFFFFF' }}>{r.source ?? 'unnamed'}</span>
                  <span style={{ color: '#8052FF' }}>{r.predicate ?? 'related to'}</span>
                  <span style={{ color: '#FFFFFF' }}>{r.target ?? 'unnamed'}</span>
                  {r.confidence !== null && (
                    <span style={{ color: '#7A7A7A', fontSize: '10px', letterSpacing: '0.12em' }}>
                      {Math.round(r.confidence * 100)}% CONFIDENCE
                    </span>
                  )}
                </div>
                {r.context !== null && (
                  <span style={{ fontSize: '12.5px', color: '#7A7A7A', lineHeight: 1.6, maxWidth: '70ch' }}>{r.context}</span>
                )}
              </div>
            ))}
            <span style={{ ...note, letterSpacing: '0.14em' }}>
              GET /context/relations · {relations.value.relations.length} RETURNED IN {relations.value.ms} MS
            </span>
          </>
        )}
      </div>
      {/* The same graph, walked instead of listed.
          The block above is an inventory of edges. This one hands the store a
          subject the corpus later corrected and asks it to traverse: what comes
          back is the paths it reached, and beside each is the state Lacuna's
          claim graph holds for the same pair. The store returns the replaced
          edge and the live one and marks neither, which is precisely the work
          the resolver above it does. */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>THE SAME GRAPH, WALKED FOR ONE SUBJECT</span>
        {expansion.state !== 'ready' ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Walking the store.</span>
        ) : !expansion.value.available ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>Not available: {expansion.value.reason}.</span>
        ) : expansion.value.relations.length === 0 ? (
          <span style={{ fontSize: '14px', color: '#9A9A9A' }}>The store walked and reached nothing.</span>
        ) : (
          <>
            <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '62ch', lineHeight: 1.7 }}>
              HydraDB traversed its own graph for <span style={{ color: '#FFFFFF' }}>{expansion.value.subject}</span>,
              a subject the transcripts later corrected. Every edge it reached is below, beside
              what Lacuna's claim graph says of the same pair. The store reaches the replaced
              edge and the live one alike; deciding between them is the resolver's work, not the
              store's.
            </span>
            <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '62ch', lineHeight: 1.7 }}>
              The <span style={{ color: '#FFFFFF' }}>NOT A CLAIM</span> rows are the ones to read
              twice. Each is a relation the store read out of a sentence saying that nothing
              happened: a discussion deferred, an item skipped, notes reread and unchanged,
              nothing to report. They are not gaps in this memory. They are what a memory looks
              like when everything gets stored, and answering from one means answering
              &ldquo;deferred&rdquo; when somebody asks what a service depends on.
            </span>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', paddingTop: '2px' }}>
              {(['current', 'historical', 'contradicted', 'unstated'] as const).map((standing) => {
                const n = expansion.value.relations.filter((r) => r.standing === standing).length;
                if (n === 0) return null;
                return (
                  <span key={standing} style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.12em', color: STANDING_COLOUR[standing] }}>
                    {n} {STANDING_LABEL[standing]}
                  </span>
                );
              })}
            </div>
            {representative(expansion.value.relations).map((r, i) => (
              <div key={r.id ?? i} style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '12px' }}>
                  <span style={{ color: '#FFFFFF' }}>{r.source ?? 'unnamed'}</span>
                  <span style={{ color: '#8052FF' }}>{r.predicate ?? 'related to'}</span>
                  <span style={{ color: '#FFFFFF' }}>{r.target ?? 'unnamed'}</span>
                  <span style={{ color: STANDING_COLOUR[r.standing], fontSize: '10px', letterSpacing: '0.14em' }}>
                    {STANDING_LABEL[r.standing]}
                  </span>
                </div>
                {r.context !== null && (
                  <span style={{ fontSize: '12.5px', color: '#7A7A7A', lineHeight: 1.6, maxWidth: '70ch' }}>{r.context}</span>
                )}
              </div>
            ))}
            <span style={{ ...note, letterSpacing: '0.14em' }}>
              POST /query GRAPH_CONTEXT · {expansion.value.relations.length} EDGES REACHED IN {expansion.value.ms} MS
            </span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid rgba(255,255,255,0.10)', paddingTop: '22px' }}>
        <span style={{ ...note, letterSpacing: '0.2em' }}>WHAT DEPENDS ON IT · THE STORE&rsquo;S GRAPH, THIS PROJECT&rsquo;S POLICY</span>
        <GraphImpact />
      </div>
    </div>
  );
}
