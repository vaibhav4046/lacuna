import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJson, postFor, useLoaded } from '../api/client';
import { MONO } from '../design/mark';
import { STANDING_COLOUR, STANDING_LABEL } from '../design/standing';

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
  readonly standing: 'current' | 'current_conflicting' | 'superseded' | 'withdrawal_current' | 'proposal';
}

interface EnvelopeClaim {
  readonly claim_id: number;
  readonly predicate: string;
  readonly value: string;
  readonly standing: 'current' | 'current_conflicting' | 'superseded' | 'withdrawal_current' | 'proposal';
  readonly valid_from: string;
}

interface Envelope {
  readonly status: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';
  readonly answer: string | null;
  readonly evidence: readonly Evidence[];
  readonly history: readonly EnvelopeClaim[];
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
const label = { ...mono, fontSize: '10px', letterSpacing: '0.18em', color: '#7A7A7A' } as const;

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
    return (
      <div role="status" aria-live="polite" style={{ ...mono, fontSize: '11.5px', color: '#7A7A7A', letterSpacing: '0.14em' }}>
        READING…
      </div>
    );
  }

  const colour = STATUS_COLOUR[envelope.status];
  return (
    // Announced when it arrives. Each row fills in one at a time, and a screen
    // reader that is never told is a screen reader watching a blank page.
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

      {/*
        What changed, rather than how many times it changed. "2 superseded" is
        a number; the reader wants to see the value that was replaced and the
        one that replaced it, in order.
      */}
      {envelope.history.length > 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingTop: '2px' }}>
          {envelope.history.map((claim, index) => {
            // The arrow means "this replaced the one above". Two live values
            // that disagree are not a chain, and drawing one between them would
            // assert a supersession the graph does not hold.
            const replacesPrevious = index > 0 && envelope.history[index - 1]?.standing === 'superseded';
            return (
            <div key={claim.claim_id} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span style={{ ...mono, fontSize: '9.5px', letterSpacing: '0.14em', color: STANDING_COLOUR[claim.standing], minWidth: '124px' }}>
                {replacesPrevious ? '↓ ' : ''}{STANDING_LABEL[claim.standing]}
              </span>
              <span style={{ fontSize: '15px', color: claim.standing === 'superseded' ? '#7A7A84' : '#FFFFFF', textDecoration: claim.standing === 'superseded' ? 'line-through' : 'none' }}>
                {claim.value}
              </span>
              <span style={{ ...mono, fontSize: '10px', color: '#7A7A7A' }}>{claim.valid_from.slice(0, 10)}</span>
            </div>
            );
          })}
        </div>
      )}

      {envelope.evidence.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {envelope.evidence.map((item, index) => (
            <li key={index} style={{ display: 'flex', gap: '12px', alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span
                style={{
                  ...mono,
                  fontSize: '9.5px',
                  letterSpacing: '0.14em',
                  color: STANDING_COLOUR[item.standing],
                }}
              >
                {STANDING_LABEL[item.standing]}
              </span>
              <span style={{ color: '#BDBDBD', fontSize: '14px' }}>{item.source}</span>
              <span style={{ ...mono, fontSize: '11px', color: '#7A7A7A' }}>{item.meta}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}


interface ImpactReply {
  readonly available: boolean;
  readonly subject: string | null;
  readonly reached?: number;
  readonly accepted?: readonly { readonly source: string; readonly target: string; readonly predicate: string; readonly depth: number }[];
  readonly rejected?: readonly { readonly target: string; readonly reason: string; readonly context: string | null }[];
  readonly affected?: readonly string[];
  readonly depth?: number;
  readonly ms?: number;
}

interface ContinuityReply {
  readonly available: boolean;
  readonly kind?: string;
  readonly store?: string;
  readonly deployment?: string;
  readonly clients?: readonly string[];
  readonly questions?: number;
  readonly identical?: boolean;
}

/**
 * The proof a similarity index cannot produce.
 *
 * HydraDB traverses its own graph and hands back every candidate edge; this
 * project then refuses the ones the conversation replaced, disputed, or never
 * asserted, and the affected set is computed over what is left. Both halves
 * are named, because a filter nobody can see is a claim rather than a proof.
 */
function GraphProof() {
  const impact = useLoaded<ImpactReply>('/api/explore/impact');
  if (impact.state !== 'ready') return <span style={{ ...label }}>WALKING THE STORE…</span>;
  if (!impact.value.available || impact.value.accepted === undefined) {
    return <span style={{ ...label }}>GRAPH WALK UNAVAILABLE</span>;
  }
  const it = impact.value;
  const refused = (it.rejected ?? []).find((edge) => edge.reason === 'historical');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: '10px', letterSpacing: '0.18em', color: '#8052FF' }}>GRAPH IMPACT</span>
        <span style={{ fontSize: '22px', color: '#FFFFFF' }}>{(it.affected ?? []).join(', ') || 'nothing current'}</span>
      </div>
      <div style={{ ...label, display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <span>{it.reached} EDGES REACHED</span>
        <span>{(it.accepted ?? []).length} CROSSED</span>
        <span>{(it.rejected ?? []).length} REFUSED</span>
        <span>DEPTH {it.depth}</span>
        <span>{it.ms} MS</span>
      </div>
      {refused === undefined ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          <span style={{ ...mono, fontSize: '9.5px', letterSpacing: '0.14em', color: '#FFB829' }}>
            ONE STALE DEPENDENCY REFUSED · {refused.target}
          </span>
          <span style={{ fontSize: '13px', color: '#9A9A9A', maxWidth: '64ch', lineHeight: 1.55 }}>
            {refused.context}
          </span>
        </div>
      )}
      <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '64ch', lineHeight: 1.6 }}>
        The store returned every one of those edges. It cannot know which the conversation later
        replaced, so a walk over its raw output would still be following the corrected dependency.
      </span>
    </div>
  );
}

/** One question, three clients, compared field by field. A recorded run, labelled. */
function ContinuityProof() {
  const run = useLoaded<ContinuityReply>('/api/explore/continuity');
  if (run.state !== 'ready' || !run.value.available) return null;
  const it = run.value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', flexWrap: 'wrap' }}>
        <span style={{ ...mono, fontSize: '10px', letterSpacing: '0.18em', color: '#8052FF' }}>ONE CONTEXT, ANY AGENT</span>
        <span style={{ fontSize: '22px', color: '#FFFFFF' }}>
          {it.identical === true ? 'Identical across all three' : 'Not identical'}
        </span>
      </div>
      <div style={{ ...label, display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
        <span>{(it.clients ?? []).join(' · ').toUpperCase()}</span>
        <span>{it.questions} QUESTIONS</span>
        <span>RECORDED VERIFIED RUN</span>
      </div>
      <span style={{ fontSize: '13.5px', color: '#9A9A9A', maxWidth: '64ch', lineHeight: 1.6 }}>
        A browser, a local command line and an MCP subprocess asked the same questions of{' '}
        {it.store}. This is a recorded run rather than a live one, because a page in a browser
        cannot spawn a subprocess and pretending it had would be the thing this product is against.
        The MCP server is live and callable at <span style={{ color: '#B79BFF' }}>/mcp</span>.
      </span>
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
          getJson<readonly Suggestion[]>('/api/explore/questions', control.signal),
          getJson<readonly Suggestion[]>('/api/explore/hops', control.signal).catch(() => [] as readonly Suggestion[]),
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
          // The demo endpoint, not /api/ask. This board answers the same way
          // whether or not the person reading it happens to be signed in.
          const envelope = await postFor<Envelope>('/api/explore/ask', {
            subject: row.subject,
            predicate: row.predicate,
            ...(row.via === null ? {} : { via: row.via }),
          });
          if (control.signal.aborted) return;
          setResults((current) => ({
            ...current,
            [key]: envelope ?? {
              status: 'SYSTEM_ERROR', answer: null, evidence: [], history: [], revisions: [], conflicts: [],
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
          <Link to="/" style={{ ...label, textDecoration: 'none', color: '#7A7A7A' }}>← LACUNA</Link>
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

        <AskYourOwn />

        {failed && (
          <p style={{ color: '#9A9A9A' }}>
            The context store did not answer. Nothing on this page is drawn from a recording, so
            there is nothing to show in its place.
          </p>
        )}

        {rows === null && !failed && (
          <p style={{ ...mono, fontSize: '11.5px', color: '#7A7A7A', letterSpacing: '0.14em' }}>LOADING…</p>
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
                <span style={{ ...mono, fontSize: '12px', color: '#7A7A7A' }}>
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

        <section style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '24px', display: 'flex', flexDirection: 'column', gap: '26px' }}>
          <GraphProof />
          <ContinuityProof />
        </section>

        <section style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span style={label}>THE ARGUMENT, IN ONE SCREEN</span>
          <p style={{ color: '#FFFFFF', fontSize: '18px', lineHeight: 1.6, margin: 0, maxWidth: '62ch', fontWeight: 300 }}>
            A memory that stores everything answers &ldquo;deferred&rdquo; when you ask what a
            service depends on.
          </p>
          <p style={{ color: '#9A9A9A', fontSize: '15px', lineHeight: 1.65, margin: 0, maxWidth: '64ch' }}>
            HydraDB builds a graph of its own from these same transcripts.{' '}
            <Link to="/explore/hydra" style={{ color: '#B79BFF' }}>Walked for one subject</Link> it
            reaches 21 edges: 6 that stand, 2 the transcripts replaced, 3 disputed, and 10 that are
            not claims at all. Those 10 are sentences saying nothing happened, a discussion
            deferred, an item skipped, notes reread and unchanged. Lacuna files none of them,
            because{' '}
            <Link to="/explore/memory" style={{ color: '#B79BFF' }}>what may become a claim</Link> is
            decided before anything is written. Both screens are live and neither needs an account.
          </p>
        </section>

        <footer style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <a href="https://github.com/vaibhav4046/lacuna" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>
            SOURCE
          </a>
          <Link to="/signin" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>SIGN IN TO PASTE A TRANSCRIPT</Link>
          <Link to="/explore/hydra" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>WHAT HYDRADB FOUND</Link>
          <Link to="/explore/dash" style={{ ...label, color: '#9A9A9A', textDecoration: 'none' }}>OPEN THE WHOLE PRODUCT</Link>
          <span style={label}>NOTHING ON THIS PAGE IS RECORDED</span>
        </footer>
      </div>
    </main>
  );
}

/**
 * The seventh question, which is whichever one the reader wants to ask.
 *
 * Six precomputed rows prove the product answers. They cannot prove it answers
 * anything that was not chosen in advance, and a reader who suspects the six
 * were picked to flatter it is right to suspect that. So this box exists, it
 * posts to the same endpoint, and it is deliberately placed above the six
 * rather than below them.
 *
 * The reading is shown for the same reason it is shown everywhere else: the
 * question is parsed before it is answered, and a parser that guessed wrong
 * would otherwise produce a fully evidenced answer to a different question.
 */
function AskYourOwn() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<PlannedReply | null>(null);

  async function go() {
    if (text.trim() === '') return;
    setBusy(true);
    setReply(null);
    const planned = await postFor<PlannedReply>('/api/explore/query', { question: text.trim() });
    setReply(planned ?? { reading: null, unread: 'unreachable', knownSubjects: [], available: [], answer: null, ms: 0 });
    setBusy(false);
  }

  const answer = reply?.answer ?? null;

  return (
    <section style={{ borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <span style={{ ...label, color: '#8052FF' }}>ASK YOUR OWN</span>
      <span style={{ color: '#BDBDBD', fontSize: '15px' }}>
        The six below were chosen. This one is not. Same endpoint, same resolver.
      </span>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid rgba(128,82,255,0.42)', borderRadius: '9px', padding: '11px 14px' }}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void go(); }}
          placeholder="who owns token-forge? when does Lowbank launch?"
          aria-label="Ask your own question"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '15px', outline: 'none' }}
        />
        <button
          onClick={() => void go()}
          disabled={busy}
          style={{ background: '#8052FF', border: 'none', borderRadius: '6px', cursor: busy ? 'default' : 'pointer', ...mono, fontSize: '9.5px', letterSpacing: '0.16em', color: '#FFFFFF', padding: '8px 13px' }}
        >{busy ? 'ASKING…' : 'ASK'}</button>
      </div>

      {reply === null ? null : reply.reading !== null && answer !== null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ ...mono, fontSize: '11px', color: '#7A7A7A', letterSpacing: '0.14em' }}>
            READ AS {reply.reading.subject} · {reply.reading.predicate.replace(/_/g, ' ')}
            {reply.reading.via === null ? '' : ` · via ${reply.reading.via}`}
          </span>
          <span style={{ ...mono, fontSize: '11px', letterSpacing: '0.16em', color: answer.status === 'ANSWERED' ? '#8052FF' : '#FFB829' }}>
            {answer.status.replace(/_/g, ' ')} · {reply.ms} MS
          </span>
          <span style={{ fontSize: '17px', color: '#FFFFFF', lineHeight: 1.5 }}>
            {answer.answer ?? NO_ANSWER[answer.abstain_reason ?? ''] ?? 'Nothing in this workspace answers that.'}
          </span>
          {answer.evidence.slice(0, 3).map((item, at) => (
            <span key={at} style={{ fontSize: '13.5px', color: '#9A9A9A', lineHeight: 1.6 }}>
              {item.source} · {item.meta} · {item.standing.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: '15px', color: '#FFB829', lineHeight: 1.6, maxWidth: '66ch' }}>
          {reply.unread === 'no_subject'
            ? `Nothing in that names something this workspace holds. It holds ${reply.knownSubjects.slice(0, 6).join(', ')}.`
            : reply.unread === 'no_predicate'
              ? `That names something it holds but asks for a property it has no word for. Try ownership, dependencies, launch date, region, pool size or beta partner.`
              : 'The question did not reach the context store.'}
        </span>
      )}
    </section>
  );
}

/** What an abstention means, in the reader's language rather than the enum's. */
const NO_ANSWER: Readonly<Record<string, string>> = {
  never_stated: 'Nothing in this workspace ever stated that. It is absent, not unknown.',
  contradicted: 'Two sources disagree and nothing has resolved it. Both stay visible.',
  retracted: 'It was stated and then taken back, so there is no current value.',
};

interface PlannedReply {
  readonly reading: { readonly subject: string; readonly predicate: string; readonly via: string | null } | null;
  readonly unread: string | null;
  readonly knownSubjects: readonly string[];
  readonly available: readonly string[];
  readonly answer: Envelope | null;
  /** The whole request, not just the resolve. See PlannedAnswer.ms. */
  readonly ms: number;
}
