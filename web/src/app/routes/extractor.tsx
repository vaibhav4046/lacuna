import { useState } from 'react';

import { MONO } from '../../design/mark';
import { Empty, Failed, Stage } from '../state';

/**
 * Prose in, claims out, with the reader's own text if they want.
 *
 * Every other panel in this product reads a graph that was built from
 * annotations, which is a fair way to measure a resolver and no evidence at all
 * about where the graph came from. This one runs the extractor, so the step
 * nothing else shows is the one on screen: which sentence became a claim, under
 * what reading, and which earlier claim it replaced.
 *
 * It writes nothing and stores nothing. The endpoint behind it is a pure
 * function of the text handed to it.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#5E5E5E' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#5E5E5E' } as const;

interface ExtractedRow {
  readonly key: string;
  readonly subject: string;
  readonly predicate: string;
  readonly property: string;
  readonly mode: string;
  readonly stating: boolean;
  readonly objectText: string;
  readonly supersedes: string | null;
  readonly quote: string;
}

interface ExtractionReport {
  readonly turns: number;
  readonly sentences: number;
  readonly claims: readonly ExtractedRow[];
  readonly unread: number;
  readonly ms: number;
  readonly truncated: boolean;
  readonly readableProperties: readonly string[];
}

/** The reading a claim was taken under, and whether an answer may be drawn from it. */
function ModeTag({ mode, stating }: { mode: string; stating: boolean }) {
  const title = stating
    ? 'A statement. The resolver may answer with this.'
    : 'Not a statement. Filed where the resolver cannot read it as current state.';
  return (
    <span
      title={title}
      style={{
        fontFamily: MONO,
        fontSize: '9px',
        letterSpacing: '0.12em',
        padding: '2px 6px',
        borderRadius: '5px',
        whiteSpace: 'nowrap',
        border: `1px solid ${stating ? 'rgba(128,82,255,0.55)' : 'rgba(255,255,255,0.16)'}`,
        color: stating ? '#B79BFF' : '#8A8A8A',
      }}
    >
      {mode}
    </span>
  );
}

export function Extractor() {
  const [text, setText] = useState('');
  const [report, setReport] = useState<ExtractionReport | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('loading');

  const run = async (prose: string): Promise<void> => {
    setState('loading');
    try {
      const query = prose.trim() === '' ? '' : `?text=${encodeURIComponent(prose)}`;
      const response = await fetch(`/api/demo/extract${query}`);
      if (!response.ok) throw new Error('failed');
      setReport(await response.json() as ExtractionReport);
      setState('idle');
    } catch {
      setState('failed');
    }
  };

  const [started, setStarted] = useState(false);
  if (!started) {
    setStarted(true);
    void run('');
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        paddingTop: '18px',
        borderTop: '1px solid rgba(255,255,255,0.14)',
      }}
    >
      <div>
        <div style={{ ...head, paddingBottom: '6px' }}>BEFORE THE GRAPH · PROSE INTO CLAIMS</div>
        <p style={{ fontSize: '13.5px', color: '#BDBDBD', margin: 0, maxWidth: '76ch', lineHeight: 1.55 }}>
          Everything above reads a graph. This reads a transcript. Each row is a sentence
          the extractor could justify a claim from, the reading it took it under, and the
          claim it replaced. A suggestion or a question is filed where the resolver cannot
          read it as current state, which is why a plan nobody adopted never becomes an
          answer.
        </p>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Paste a transcript, one speaker per line. Leave it empty for the built in one."
        rows={4}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: '8px',
          padding: '11px 13px',
          color: '#FFFFFF',
          fontFamily: MONO,
          fontSize: '12px',
          outline: 'none',
          resize: 'vertical',
          lineHeight: 1.6,
        }}
      />

      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="hv-text"
          onClick={() => void run(text)}
          style={{
            background: 'none',
            cursor: 'pointer',
            borderRadius: '7px',
            padding: '8px 14px',
            fontFamily: MONO,
            fontSize: '10px',
            letterSpacing: '0.12em',
            border: '1px solid rgba(128,82,255,0.55)',
            color: '#FFFFFF',
          }}
        >
          EXTRACT
        </button>
        <button
          className="hv-text"
          onClick={() => {
            setText('');
            void run('');
          }}
          style={{
            background: 'none',
            cursor: 'pointer',
            borderRadius: '7px',
            padding: '8px 14px',
            fontFamily: MONO,
            fontSize: '10px',
            letterSpacing: '0.12em',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#9A9A9A',
          }}
        >
          BUILT IN TRANSCRIPT
        </button>
        {report === null ? null : (
          <span style={note}>
            {report.turns} TURNS · {report.sentences} SENTENCES · {report.claims.length} CLAIMS ·{' '}
            {report.unread} READ AND NOT USED · {report.ms}MS
          </span>
        )}
      </div>

      {state === 'loading' ? <Stage label="READING" /> : null}
      {state === 'failed' ? <Failed reason="the extractor did not answer" /> : null}

      {report !== null && report.truncated ? (
        <div style={{ ...note, color: '#BDBDBD' }}>TEXT WAS LONGER THAN THE LIMIT AND WAS CUT</div>
      ) : null}

      {report !== null && state === 'idle' && report.claims.length === 0 ? (
        <Empty
          headline="Nothing in that text became a claim."
          detail={`The extractor reads a fixed set of sentence shapes rather than English, covering ${report.readableProperties.join(', ')}. Prose about anything else produces nothing rather than a guess.`}
        />
      ) : null}

      {report !== null && report.claims.length > 0 ? (
        <div>
          {report.claims.map((claim) => (
            <div
              key={claim.key}
              className="hv-surface3"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                padding: '11px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.07)',
                opacity: claim.stating ? 1 : 0.62,
              }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '14.5px', color: '#FFFFFF' }}>
                  {claim.subject} <span style={{ color: '#9A9A9A' }}>{claim.predicate}</span>{' '}
                  {claim.objectText}
                </span>
                <ModeTag mode={claim.mode} stating={claim.stating} />
                {claim.supersedes === null ? null : (
                  <span style={{ ...note, color: '#B79BFF' }}>REPLACES AN EARLIER VALUE</span>
                )}
                {claim.predicate === claim.property ? null : (
                  <span style={note}>NOT ON {claim.property.toUpperCase()}</span>
                )}
              </div>
              <span style={{ fontFamily: MONO, fontSize: '11px', color: '#8A8A8A' }}>
                &ldquo;{claim.quote}&rdquo;
              </span>
            </div>
          ))}
          <div style={{ padding: '12px 4px', ...note }}>
            READS {report.readableProperties.join(' · ').toUpperCase()} · NOT ENGLISH
          </div>
        </div>
      ) : null}
    </div>
  );
}
