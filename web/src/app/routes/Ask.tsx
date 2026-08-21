import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postFor } from '../../api/client';
import { useScope, useScoped } from '../../api/scope';
import { MONO } from '../../design/mark';
import { STANDING_COLOUR, STANDING_LABEL } from '../../design/standing';
import { askEndpoint } from '../product-contracts';

/**
 * Ask, wired to the real answer path.
 *
 * The design draws two states with the sample workspace's own answer in them.
 * Both are real here: the question goes to the same core the CLI and MCP use,
 * and the screen renders whatever came back. An abstention is a result and is
 * drawn calmly, in the design's own NO EVIDENCE treatment, with the reason the
 * resolver gave. A dependency that did not answer is a different thing and
 * says so.
 */

interface Evidence {
  readonly source: string;
  readonly meta: string;
  readonly standing: 'current' | 'current_conflicting' | 'superseded' | 'withdrawal_current' | 'proposal';
}

interface Envelope {
  readonly status: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';
  readonly answer: string | null;
  readonly evidence: readonly Evidence[];
  readonly revisions: readonly number[];
  readonly conflicts: readonly string[];
  readonly abstain_reason: string | null;
  readonly context_pack_id: string | null;
  readonly trace_id: string;
  readonly source_state: string;
  readonly took_ms: number;
}

/**
 * Suggested questions come from the workspace, not from this file. A chip that
 * names a subject the graph has never heard of abstains every time and looks
 * like a broken product rather than a working one.
 */
interface Reading {
  readonly subject: string;
  readonly predicate: string;
  readonly via: string | null;
  readonly matched: { readonly subject: string; readonly predicate: string };
}

interface Planned {
  readonly reading: Reading | null;
  readonly unread: string | null;
  readonly knownSubjects: readonly string[];
  /** What this workspace records about the subject that matched. */
  readonly available: readonly string[];
  readonly answer: Envelope | null;
  /** The whole request, not just the resolve. See PlannedAnswer.ms. */
  readonly ms: number;
}

interface Unread {
  readonly failure: string;
  readonly knownSubjects: readonly string[];
  readonly available: readonly string[];
}

interface Suggestion {
  readonly label: string;
  readonly subject: string;
  readonly predicate: string;
}

const STATUS_WORD: Readonly<Record<Envelope['status'], string>> = {
  ANSWERED: 'ANSWERED',
  PARTIAL: 'PARTIAL',
  CONFLICT: 'CONFLICT',
  NO_EVIDENCE: 'NO EVIDENCE',
  SYSTEM_ERROR: 'SYSTEM ERROR',
};

/** Violet for an answer, grey for everything else. Never red, never alarm. */
const STATUS_COLOUR: Readonly<Record<Envelope['status'], string>> = {
  ANSWERED: '#8052FF',
  PARTIAL: '#FFB829',
  CONFLICT: '#BDBDBD',
  NO_EVIDENCE: '#9A9A9A',
  SYSTEM_ERROR: '#9A9A9A',
};

const meta = { fontFamily: MONO, fontSize: '11.5px', letterSpacing: '0.14em', color: '#9A9A9A' } as const;
const key = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A', paddingTop: '3px' } as const;
const value = { color: '#BDBDBD' } as const;
const tag = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', flexShrink: 0 } as const;

export function Ask() {
  const go = useNavigate();
  const { prefix, base, demo } = useScope();
  const suggested = useScoped<readonly Suggestion[]>('questions');
  const [asked, setAsked] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [predicate, setPredicate] = useState('');
  const [result, setResult] = useState<Envelope | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState(true);
  const [sentence, setSentence] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [unread, setUnread] = useState<Unread | null>(null);

  const chips = suggested.state === 'ready' ? suggested.value : [];

  /**
   * A question written as a sentence.
   *
   * The parser runs on the server and the answer comes back through the same
   * resolver every other question uses, so nothing about the evidence changes.
   * What comes back alongside it is the reading, which is rendered, because a
   * parser that guessed wrong would otherwise produce a fully evidenced answer
   * to a question nobody asked and look exactly like a correct one.
   */
  /**
   * A question that arrived in the URL, run once on arrival.
   *
   * The Dashboard field hands the question over rather than making somebody
   * retype it, and a shared link to an answer is worth having. It runs once:
   * re-running on every render would spend a request per keystroke elsewhere on
   * the page.
   */
  useEffect(() => {
    const carried = new URLSearchParams(window.location.search).get('q');
    if (carried === null || carried.trim() === '') return;
    setSentence(carried);
    void askSentence(carried);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSentence() {
    await askSentence(sentence);
  }

  async function askSentence(text: string) {
    if (text.trim() === '') return;
    setAsked(text.trim());
    setResult(null);
    setReading(null);
    setUnread(null);
    setStage('READING THE QUESTION');
    const planned = await postFor<Planned>(`${base}/query`, { question: text.trim() });
    setStage(null);
    if (planned === null) {
      setUnread({ failure: 'unreachable', knownSubjects: [], available: [] });
      return;
    }
    if (planned.reading === null || planned.answer === null) {
      setUnread({ failure: planned.unread ?? 'no_subject', knownSubjects: planned.knownSubjects, available: planned.available });
      return;
    }
    setReading(planned.reading);
    setSubject(planned.reading.subject);
    setPredicate(planned.reading.predicate);
    setResult(planned.answer);
  }

  async function run(question: Suggestion) {
    setReading(null);
    setUnread(null);
    setAsked(question.label);
    setSubject(question.subject);
    setPredicate(question.predicate);
    setResult(null);
    setStage('CHECKING CURRENT STATE');
    const envelope = await postFor<Envelope>(askEndpoint(demo), { subject: question.subject, predicate: question.predicate });
    setStage(null);
    setResult(envelope ?? {
      status: 'SYSTEM_ERROR', answer: null, evidence: [], revisions: [], conflicts: [],
      abstain_reason: 'the request did not reach the context store', context_pack_id: null,
      trace_id: '—', source_state: 'unavailable', took_ms: 0,
    });
  }

  async function runTyped() {
    setReading(null);
    setUnread(null);
    if (subject.trim() === '' || predicate.trim() === '') return;
    await run({ label: `${subject.trim()} · ${predicate.trim()}`, subject: subject.trim(), predicate: predicate.trim() });
  }

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', border: '1px solid rgba(128,82,255,0.42)', borderRadius: '10px', padding: '14px 18px' }}>
        <input
          className="fv-violet"
          value={sentence}
          onChange={(e) => setSentence(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runSentence(); }}
          placeholder="Ask in a sentence. Who owns token-forge? When does Lowbank launch?"
          aria-label="Ask a question"
          style={{ flex: 1, minWidth: '0', background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '15px', outline: 'none' }}
        />
        <button className="hv-violet" onClick={() => void runSentence()} style={{ background: '#8052FF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#FFFFFF', padding: '8px 14px' }}>ASK</button>
      </div>

      {reading === null ? null : (
        /*
          What it understood, before the answer. A parser in front of a resolver
          can produce the one failure nothing else here can: a correct, fully
          evidenced answer to a question nobody asked. This line is the only
          place that is catchable, so it is never collapsed or hidden.
        */
        <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>
          <span>READ AS</span>
          <span style={{ color: '#FFFFFF' }}>{reading.subject} · {reading.predicate}{reading.via === null ? '' : ` · via ${reading.via}`}</span>
          <span>FROM YOUR WORDS “{reading.matched.predicate}”</span>
        </div>
      )}

      {unread === null ? null : (
        <div style={{ border: '1px solid rgba(255,184,41,0.35)', borderRadius: '10px', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '14px', color: '#FFB829', maxWidth: '70ch', lineHeight: 1.6 }}>
            {unread.failure === 'no_subject'
              ? 'Nothing in that question names something this workspace holds. The subject is unknown, not the answer.'
              : unread.failure === 'no_predicate'
                ? `That names something this workspace holds, but asks for a property it does not record${unread.available.length === 0 ? '.' : `. About ${unread.knownSubjects[0] ?? 'it'} it records ${unread.available.map((p) => p.replace(/_/g, ' ')).join(', ')}.`}`
                : unread.failure === 'unreachable'
                  ? 'The question did not reach the context store.'
                  : 'Type a question first.'}
          </span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' }}>
            {unread.available.length > 0
              ? unread.available.slice(0, 12).map((property) => (
                <button
                  key={property}
                  className="hv-text"
                  onClick={() => setSentence(`what is the ${property.replace(/_/g, ' ')} for ${unread.knownSubjects[0] ?? ''}?`)}
                  style={{ background: 'none', cursor: 'pointer', borderRadius: '6px', padding: '5px 9px', fontFamily: MONO, fontSize: '10.5px', border: '1px solid rgba(255,255,255,0.12)', color: '#9A9A9A' }}
                >{property.replace(/_/g, ' ')}</button>
              ))
              : unread.knownSubjects.slice(0, 12).map((name) => (
                <button
                  key={name}
                  className="hv-text"
                  onClick={() => setSentence(`who owns ${name}?`)}
                  style={{ background: 'none', cursor: 'pointer', borderRadius: '6px', padding: '5px 9px', fontFamily: MONO, fontSize: '10.5px', border: '1px solid rgba(255,255,255,0.12)', color: '#9A9A9A' }}
                >{name}</button>
              ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '14px 18px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.2em', color: '#7A7A7A' }}>EXACT</span>
        <input
          className="fv-violet"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runTyped(); }}
          placeholder="subject"
          aria-label="Subject"
          style={{ flex: 1, minWidth: '120px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', padding: '6px 10px', color: '#FFFFFF', fontFamily: MONO, fontSize: '13px', outline: 'none' }}
        />
        <input
          className="fv-violet"
          value={predicate}
          onChange={(e) => setPredicate(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void runTyped(); }}
          placeholder="predicate"
          aria-label="Predicate"
          style={{ flex: 1, minWidth: '120px', background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', padding: '6px 10px', color: '#FFFFFF', fontFamily: MONO, fontSize: '13px', outline: 'none' }}
        />
        <button className="hv-violet" onClick={() => void runTyped()} style={{ background: '#8052FF', border: 'none', borderRadius: '6px', cursor: 'pointer', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#FFFFFF', padding: '7px 12px' }}>ASK</button>
        <button className="hv-edge35" onClick={() => go(`${prefix}/voice`)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', cursor: 'pointer', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '6px 10px' }}>VOICE</button>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#7A7A7A' }}>MODE · FAST</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {chips.map((c) => (
          <button key={c.label} className="hv-text" onClick={() => void run(c)} style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '7px 12px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.06em', border: '1px solid rgba(255,255,255,0.12)', color: asked === c.label ? '#FFFFFF' : '#9A9A9A' }}>{c.label}</button>
        ))}
        {suggested.state === 'ready' && chips.length === 0 ? (
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>NO SUGGESTIONS · THIS WORKSPACE HOLDS NO CLAIMS YET</span>
        ) : null}
      </div>

      {stage !== null ? (
        <div style={{ padding: '22px 4px' }}>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' }}>{stage}</span>
        </div>
      ) : null}

      {result === null ? (
        stage === null ? (
          <div style={{ padding: '22px 4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '15px', color: '#FFFFFF' }}>Nothing asked yet.</span>
            <span style={{ fontSize: '13.5px', color: '#9A9A9A' }}>Type a subject and a predicate, or pick one of the questions this workspace can answer.</span>
          </div>
        ) : null
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '22px 4px 0' }}>
          <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.22em', color: STATUS_COLOUR[result.status] }}>{STATUS_WORD[result.status]}</span>

          {result.status === 'ANSWERED' || result.status === 'PARTIAL' ? (
            <>
              <div style={{ fontSize: 'clamp(44px, 5vw, 72px)', fontWeight: 400, letterSpacing: '-0.035em', lineHeight: 1, color: '#FFFFFF' }}>{result.answer}</div>
              <div style={meta}>
                {result.evidence.length} SUPPORTING {result.evidence.length === 1 ? 'SOURCE' : 'SOURCES'}
                {result.revisions.length > 0 ? ` · ${result.revisions.length} KEPT IN HISTORY` : ''}
                {` · ${result.took_ms} MS`}
              </div>
              <div style={{ display: 'flex', gap: '22px', marginTop: '8px', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <button onClick={() => setEvOpen(!evOpen)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 3px', fontSize: '14px', color: '#FFFFFF', borderBottom: '1px solid #8052FF' }}>Evidence</button>
                <button className="hv-text" onClick={() => go(`${prefix}/timeline`)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 3px', fontSize: '14px', color: '#BDBDBD', borderBottom: '1px solid transparent' }}>Timeline</button>
                <button className="hv-text" onClick={() => go(`${prefix}/graph`)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 3px', fontSize: '14px', color: '#BDBDBD', borderBottom: '1px solid transparent' }}>Graph</button>
                <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A' }}>TRACE {result.trace_id.toUpperCase()}</span>
              </div>
              {evOpen ? (
                <div style={{ border: '1px solid rgba(255,255,255,0.10)', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', padding: '4px 18px', marginTop: '6px' }}>
                  {result.evidence.length === 0 ? (
                    <div style={{ padding: '18px 0', fontSize: '14px', color: '#9A9A9A' }}>The answer carries no evidence spans.</div>
                  ) : result.evidence.map((e, i) => (
                    <div key={`${e.source}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '18px', padding: '14px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div>
                        <div style={{ fontSize: '14.5px', color: '#FFFFFF' }}>{e.source}</div>
                        <div style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.1em', color: '#9A9A9A', marginTop: '5px' }}>{e.meta}</div>
                      </div>
                      <span style={{ ...tag, color: STANDING_COLOUR[e.standing] }}>{STANDING_LABEL[e.standing]}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {result.status === 'CONFLICT' ? (
            <>
              <div style={{ fontSize: 'clamp(30px, 3.2vw, 46px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1.1, color: '#FFFFFF' }}>The sources disagree.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 26px', marginTop: '10px', fontSize: '14px', maxWidth: '620px' }}>
                {result.conflicts.map((line) => (
                  <span key={line} style={{ gridColumn: '1 / -1', color: '#BDBDBD' }}>{line}</span>
                ))}
                <span style={key}>STANDING</span><span style={value}>Both claims stay visible with equal weight</span>
                <span style={key}>RESOLVES</span><span style={value}>Evidence, or an explicit policy. Recency alone never wins.</span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A', marginTop: '8px' }}>ABSTAIN_REASON · {(result.abstain_reason ?? 'contradicted').toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
            </>
          ) : null}

          {result.status === 'NO_EVIDENCE' ? (
            <>
              <div style={{ fontSize: 'clamp(30px, 3.2vw, 46px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1.1, color: '#FFFFFF' }}>No supporting evidence.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px 26px', marginTop: '10px', fontSize: '14px', maxWidth: '620px' }}>
                <span style={key}>REQUIRED</span><span style={value}>A claim that states this value</span>
                <span style={key}>FOUND</span><span style={value}>{result.evidence.length} related {result.evidence.length === 1 ? 'fragment' : 'fragments'} · none states it</span>
                <span style={key}>MISSING</span><span style={value}>A source that commits to a value</span>
                <span style={key}>RESOLVES</span><span style={value}>Ingest the source, or record the decision</span>
              </div>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A', marginTop: '8px' }}>ABSTAIN_REASON · {(result.abstain_reason ?? 'no_evidence').toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
            </>
          ) : null}

          {result.status === 'SYSTEM_ERROR' ? (
            <>
              <div style={{ fontSize: 'clamp(30px, 3.2vw, 46px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1.1, color: '#FFFFFF' }}>HydraDB unavailable.</div>
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '52ch' }}>This is a dependency failure, not an answer. Nothing about the memory changed and no claim was made.</p>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#7A7A7A', marginTop: '8px' }}>SOURCE_STATE · {result.source_state.toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
