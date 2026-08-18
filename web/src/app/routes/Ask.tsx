import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { postFor } from '../../api/client';
import { MONO } from '../../design/mark';

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
  readonly standing: 'current' | 'superseded' | 'proposal';
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

/** The design's two example questions, as subject and predicate pairs. */
const CHIPS: readonly { readonly l: string; readonly subject: string; readonly predicate: string }[] = [
  { l: 'Where does session state live now?', subject: 'session-store', predicate: 'runs_on' },
  { l: 'What is the connection pool size?', subject: 'session-store', predicate: 'pool_size' },
];

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
const key = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#5E5E5E', paddingTop: '3px' } as const;
const value = { color: '#BDBDBD' } as const;
const tag = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', flexShrink: 0 } as const;

export function Ask() {
  const go = useNavigate();
  const [picked, setPicked] = useState(0);
  const [result, setResult] = useState<Envelope | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [evOpen, setEvOpen] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);

  const chip = CHIPS[picked] ?? CHIPS[0];

  async function run(index: number) {
    const question = CHIPS[index];
    if (question === undefined) return;
    setPicked(index);
    setResult(null);
    setStage('CHECKING CURRENT STATE');
    const envelope = await postFor<Envelope>('/api/ask', { subject: question.subject, predicate: question.predicate });
    setStage(null);
    setResult(envelope ?? {
      status: 'SYSTEM_ERROR', answer: null, evidence: [], revisions: [], conflicts: [],
      abstain_reason: 'the request did not reach the context store', context_pack_id: null,
      trace_id: '—', source_state: 'unavailable', took_ms: 0,
    });
  }

  return (
    <div style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '10px', padding: '14px 18px', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: MONO, fontSize: '10px', fontWeight: 500, letterSpacing: '0.2em', color: '#8052FF' }}>ASK</span>
        <span style={{ fontFamily: MONO, fontSize: '13.5px', color: '#FFFFFF', flex: 1, minWidth: '200px' }}>{chip?.l}</span>
        <button className="hv-edge35" onClick={() => setVoiceOn(!voiceOn)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', cursor: 'pointer', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#BDBDBD', padding: '6px 10px' }}>VOICE</button>
        <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.14em', color: '#5E5E5E' }}>MODE · FAST</span>
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {CHIPS.map((c, i) => (
          <button key={c.l} className="hv-text" onClick={() => void run(i)} style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '7px 12px', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.06em', border: '1px solid rgba(255,255,255,0.12)', color: picked === i ? '#FFFFFF' : '#9A9A9A' }}>{c.l}</button>
        ))}
      </div>

      {voiceOn ? (
        <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '10px', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#FFB829', animation: 'lpulse 1.6s ease-in-out infinite' }}></span>
          <span style={{ fontFamily: MONO, fontSize: '10.5px', letterSpacing: '0.2em', color: '#BDBDBD' }}>LISTENING</span>
          <span style={{ fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em', color: '#5E5E5E' }}>VOICE PROVIDER NOT CONFIGURED · TEXT IS STILL AVAILABLE</span>
        </div>
      ) : null}

      {stage !== null ? (
        <div style={{ padding: '22px 4px' }}>
          <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' }}>{stage}</span>
        </div>
      ) : null}

      {result === null ? (
        stage === null ? (
          <div style={{ padding: '22px 4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '15px', color: '#FFFFFF' }}>Nothing asked yet.</span>
            <span style={{ fontSize: '13.5px', color: '#9A9A9A' }}>Pick a question and the answer arrives with its evidence attached.</span>
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
                <button className="hv-text" onClick={() => go('/app/timeline')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 3px', fontSize: '14px', color: '#BDBDBD', borderBottom: '1px solid transparent' }}>Timeline</button>
                <button className="hv-text" onClick={() => go('/app/graph')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 3px', fontSize: '14px', color: '#BDBDBD', borderBottom: '1px solid transparent' }}>Graph</button>
                <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E' }}>TRACE {result.trace_id.toUpperCase()}</span>
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
                      {e.standing === 'current' ? <span style={{ ...tag, color: '#FFB829' }}>SUPPORTS THE ANSWER</span> : null}
                      {e.standing === 'superseded' ? <span style={{ ...tag, color: '#5E5E5E' }}>SUPERSEDED</span> : null}
                      {e.standing === 'proposal' ? <span style={{ ...tag, color: '#5E5E5E' }}>PROPOSAL · NEVER CURRENT</span> : null}
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
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E', marginTop: '8px' }}>ABSTAIN_REASON · {(result.abstain_reason ?? 'contradicted').toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
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
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E', marginTop: '8px' }}>ABSTAIN_REASON · {(result.abstain_reason ?? 'no_evidence').toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
            </>
          ) : null}

          {result.status === 'SYSTEM_ERROR' ? (
            <>
              <div style={{ fontSize: 'clamp(30px, 3.2vw, 46px)', fontWeight: 400, letterSpacing: '-0.03em', lineHeight: 1.1, color: '#FFFFFF' }}>HydraDB unavailable.</div>
              <p style={{ fontSize: '15px', lineHeight: 1.7, color: '#9A9A9A', margin: 0, maxWidth: '52ch' }}>This is a dependency failure, not an answer. Nothing about the memory changed and no claim was made.</p>
              <span style={{ fontFamily: MONO, fontSize: '10px', letterSpacing: '0.14em', color: '#5E5E5E', marginTop: '8px' }}>SOURCE_STATE · {result.source_state.toUpperCase()} · TRACE {result.trace_id.toUpperCase()}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
