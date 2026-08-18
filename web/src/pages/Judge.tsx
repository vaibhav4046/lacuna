import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJson, postFor } from '../api/client';
import { MONO } from '../design/mark';

/**
 * The product, working, without an account.
 *
 * Every answer on this page is computed when the page asks for it. There is no
 * recorded reply, no branch keyed on the question, and no path that returns a
 * value this file knows in advance: each row posts to the same endpoint the
 * signed-in Ask screen posts to, which runs the same resolver the CLI and the
 * MCP server run, over the same records in HydraDB Cloud. The status, the
 * value, the citations, the revision count and the milliseconds are whatever
 * came back.
 *
 * The five rows are chosen to reach five different outcomes, because a page
 * that only ever shows answers is not showing a memory system. One is current
 * state. One has been revised, and says how many times. One has sources that
 * disagree and refuses to pick. One is a real subject with a predicate nobody
 * ever stated, and abstains. One is two hops, which no single lookup can
 * reach.
 */

interface Evidence {
  readonly source: string;
  readonly meta: string;
  readonly standing: 'current' | 'superseded' | 'proposal';
}

interface Envelope {
  readonly status: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';
  readonly answer: string | null;
  readonly evidence: readonly Evidence[];
  readonly revisions: readonly number[];
  readonly conflicts: readonly string[];
  readonly abstain_reason: string | null;
  readonly trace_id: string;
  readonly source_state: string;
  readonly took_ms: number;
}

interface Suggestion {
  readonly label: string;
  readonly subject: string;
  readonly predicate: string;
}

interface Row {
  readonly heading: string;
  readonly note: string;
  readonly subject: string;
  readonly predicate: string;
  readonly via: string | null;
}

interface HealthCheck {
  readonly name: string;
  readonly state: string;
  readonly detail: string;
}

interface Health {
  readonly ok: boolean;
  readonly checks: readonly HealthCheck[];
}

const STATUS_WORD: Readonly<Record<Envelope['status'], string>> = {
  ANSWERED: 'ANSWERED',
  PARTIAL: 'PARTIAL',
  CONFLICT: 'CONFLICT',
  NO_EVIDENCE: 'NO EVIDENCE',
  SYSTEM_ERROR: 'SYSTEM ERROR',
};

const STATUS_COLOUR: Readonly<Record<Envelope['status'], string>> = {
  ANSWERED: '#8052FF',
  PARTIAL: '#FFB829',
  CONFLICT: '#BDBDBD',
  NO_EVIDENCE: '#9A9A9A',
  SYSTEM_ERROR: '#9A9A9A',
};

const mono = { fontFamily: MONO } as const;
const label = { ...mono, fontSize: '10px', letterSpacing: '0.18em', color: '#5E5E5E' } as const;

/**
 * The subjects come from the workspace rather than from this file.
 *
 * A hardcoded subject is a subject that can stop existing when the corpus is
 * regenerated, and a page that then abstains at every row looks like a broken
 * product rather than a changed one.
 */
function rowsFrom(suggestions: readonly Suggestion[], hop: Suggestion | null): readonly Row[] {
  const at = (index: number): Suggestion | undefined => suggestions[index];
  const rows: Row[] = [];
  const headings: readonly (readonly [string, string])[] = [
    ['Current state', 'What is true now, and what it rests on.'],
    ['Revised', 'Superseded values stay readable as history.'],
    ['Sources disagree', 'Both are kept. Neither is picked.'],
    ['Withdrawn', 'Stated, then taken back.'],
    ['No evidence', 'A real subject, a value nobody ever stated.'],
  ];

  headings.forEach(([heading, note], index) => {
    const suggestion = at(index);
    if (suggestion === undefined) return;
    rows.push({ heading, note, subject: suggestion.subject, predicate: suggestion.predicate, via: null });
  });

  if (hop !== null) {
    rows.push({
      heading: 'Two hops',
      note: 'The answer is on a second entity, reached through the first.',
      subject: hop.subject,
      predicate: hop.predicate,
      via: 'vendor',
    });
  }

  return rows;
}

function Result({ envelope }: { envelope: Envelope | 'running' }) {
  if (envelope === 'running') {
    return <div style={{ ...mono, fontSize: '11.5px', color: '#5E5E5E', letterSpacing: '0.14em' }}>READING…</div>;
  }

  const colour = STATUS_COLOUR[envelope.status];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: '10px', letterSpacing: '0.18em', color: colour }}>
          {STATUS_WORD[envelope.status]}
        </span>
        <span style={{ fontSize: '22px', color: '#FFFFFF', letterSpacing: '-0.01em' }}>
          {envelope.answer ?? envelope.abstain_reason?.replace(/_/g, ' ') ?? '—'}
        </span>
      </div>

      <div style={{ ...label, display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <span>{envelope.evidence.length} SOURCE{envelope.evidence.length === 1 ? '' : 'S'}</span>
        {envelope.revisions.length > 0 && <span>{envelope.revisions.length} SUPERSEDED</span>}
        {envelope.conflicts.length > 0 && <span>{envelope.conflicts.length} CONFLICT</span>}
        <span>{envelope.took_ms} MS</span>
        <span>TRACE {envelope.trace_id}</span>
        <span>{envelope.source_state.toUpperCase()}</span>
      </div>

      {envelope.evidence.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {envelope.evidence.map((item, index) => (
            <li key={index} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span
                style={{
                  ...mono,
                  fontSize: '9.5px',
                  letterSpacing: '0.14em',
                  color: item.standing === 'current' ? '#FFB829' : '#5E5E5E',
                }}
              >
                {item.standing.toUpperCase()}
              </span>
              <span style={{ color: '#BDBDBD', fontSize: '14px' }}>{item.source}</span>
              <span style={{ ...mono, fontSize: '11px', color: '#5E5E5E' }}>{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Judge() {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [results, setResults] = useState<Readonly<Record<string, Envelope | 'running'>>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const control = new AbortController();

    void (async () => {
      try {
        const [suggestions, hops, doctor] = await Promise.all([
          getJson<readonly Suggestion[]>('/api/demo/questions', control.signal),
          getJson<readonly Suggestion[]>('/api/demo/hops', control.signal).catch(() => [] as readonly Suggestion[]),
          getJson<Health>('/api/health', control.signal).catch(() => null),
        ]);
        if (control.signal.aborted) return;
        setHealth(doctor);
        const built = rowsFrom(suggestions, hops[0] ?? null);
        setRows(built);

        // One at a time, in order, so the page fills top to bottom and the
        // milliseconds beside each row are that row's own round trip rather
        // than six requests contending for one connection.
        for (const row of built) {
          if (control.signal.aborted) return;
          const key = `${row.subject}/${row.predicate}/${row.via ?? ''}`;
          setResults((current) => ({ ...current, [key]: 'running' }));
          const envelope = await postFor<Envelope>('/api/ask', {
            subject: row.subject,
            predicate: row.predicate,
            ...(row.via === null ? {} : { via: row.via }),
          });
          if (control.signal.aborted) return;
          setResults((current) => ({
            ...current,
            [key]: envelope ?? {
              status: 'SYSTEM_ERROR', answer: null, evidence: [], revisions: [], conflicts: [],
              abstain_reason: 'the request did not reach the context store',
              trace_id: '—', source_state: 'unavailable', took_ms: 0,
            },
          }));
        }
      } catch {
        if (!control.signal.aborted) setFailed(true);
      }
    })();

    return () => control.abort();
  }, []);

  const store = health?.checks.find((check) => check.name === 'config')?.detail ?? null;

  return (
    <main style={{ background: '#000000', minHeight: '100vh', color: '#FFFFFF', padding: '48px 24px 96px' }}>
      <div style={{ maxWidth: '840px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '36px' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Link to="/" style={{ ...label, textDecoration: 'none', color: '#5E5E5E' }}>← LACUNA</Link>
          <h1 style={{ fontSize: 'clamp(30px, 5vw, 44px)', fontWeight: 300, letterSpacing: '-0.02em', margin: 0 }}>
            Six questions, answered live.
          </h1>
          <p style={{ color: '#9A9A9A', fontSize: '16px', lineHeight: 1.6, margin: 0, maxWidth: '62ch' }}>
            Each row below is computed when this page loads. Nothing is recorded and nothing is
            branched on the question: every one posts to the same endpoint the signed-in product
            uses, which reads the claim records this workspace holds in HydraDB Cloud and resolves
            them with the same code the command line and the MCP server run.
          </p>
          {store !== null && (
            <p style={{ ...label, margin: 0 }}>{store.toUpperCase()}</p>
          )}
        </header>

        {failed && (
          <p style={{ color: '#9A9A9A' }}>
            The context store did not answer. Nothing on this page is drawn from a recording, so
            there is nothing to show in its place.
          </p>
        )}

        {rows === null && !failed && (
          <p style={{ ...mono, fontSize: '11.5px', color: '#5E5E5E', letterSpacing: '0.14em' }}>LOADING…</p>
        )}

        {(rows ?? []).map((row) => {
          const key = `${row.subject}/${row.predicate}/${row.via ?? ''}`;
          const result = results[key];
          return (
            <section
              key={key}
              style={{
                borderTop: '1px solid rgba(255,255,255,0.12)',
                paddingTop: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ ...label, color: '#8052FF' }}>{row.heading.toUpperCase()}</span>
                <span style={{ color: '#BDBDBD', fontSize: '15px' }}>{row.note}</span>
                <span style={{ ...mono, fontSize: '12px', color: '#5E5E5E' }}>
                  {row.subject} · {row.predicate.replace(/_/g, ' ')}
                  {row.via === null ? '' : ` · via ${row.via}`}
                </span>
              </div>
              {result === undefined
                ? <div style={{ ...mono, fontSize: '11.5px', color: '#3A3A3A', letterSpacing: '0.14em' }}>QUEUED</div>
                : <Result envelope={result} />}
            </section>
          );
        })}

        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <a href="https://github.com/vaibhav4046/lacuna" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>
            SOURCE
          </a>
          <Link to="/signin" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>SIGN IN</Link>
          <span style={label}>NOTHING ON THIS PAGE IS RECORDED</span>
        </footer>
      </div>
    </main>
  );
}
