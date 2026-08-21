import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MONO } from '../../design/mark';
import { csrfHeaders } from '../../api/client';

/**
 * Putting something in, which is the half the product was missing.
 *
 * Every other screen reads. A signed-in person arrived at an empty workspace
 * and had no way to fill it, so the whole product was only ever demonstrable
 * against a corpus that shipped with it.
 *
 * This is one path rather than five connectors: paste a transcript, see what
 * the extractor made of it before anything is stored, and write it. What comes
 * back is what the store accepted, including the case where nothing was
 * extracted at all, which is a result rather than an error.
 */

const head = { fontFamily: MONO, fontSize: '10px', letterSpacing: '0.2em', color: '#7A7A7A' } as const;
const note = { fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#7A7A7A' } as const;

/** Matches the cap the endpoint enforces, so the counter is not a decoration. */
const MAX_SOURCE = 20_000;

interface IngestReport {
  readonly ok: true;
  readonly sourceKey: string;
  readonly turns: number;
  readonly claims: number;
  readonly entities: number;
  readonly accepted: number;
  readonly refused: readonly { readonly id: string; readonly error: string }[];
  readonly ms: number;
  readonly truncated: boolean;
}

interface IngestRefusal {
  readonly ok: false;
  readonly reason: string;
}

const REASON: Readonly<Record<string, string>> = {
  nothing_extracted:
    'Nothing in that text became a claim, so nothing was stored. The extractor reads a fixed set of sentence shapes rather than English.',
  title_required: 'Give the source a name.',
  text_required: 'Paste something first.',
  text_too_long: 'That is longer than this will read.',
};

export function AddSource({ onIngested }: { onIngested?: () => void }) {
  const go = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [state, setState] = useState<'idle' | 'working'>('idle');
  const [report, setReport] = useState<IngestReport | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setState('working');
    setProblem(null);
    setReport(null);
    try {
      const response = await fetch('/api/workspace/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ title, text }),
      });
      if (response.status === 401) {
        setProblem('Sign in first. A source is written into your workspace, not a shared one.');
        return;
      }
      if (response.status === 501) {
        setProblem('This deployment has no writable context store.');
        return;
      }
      const body = await response.json() as IngestReport | IngestRefusal | { error?: string };
      if ('ok' in body && body.ok) {
        setReport(body);
        setText('');
        onIngested?.();
        return;
      }
      const reason = 'reason' in body ? body.reason : (body as { error?: string }).error ?? 'unknown';
      setProblem(REASON[reason] ?? `That source was refused: ${reason}.`);
    } catch {
      setProblem('The request did not complete.');
    } finally {
      setState('idle');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.14)' }}>
      <div>
        <div style={{ ...head, paddingBottom: '6px' }}>ADD A SOURCE</div>
        <p style={{ fontSize: '13.5px', color: '#BDBDBD', margin: 0, maxWidth: '76ch', lineHeight: 1.55 }}>
          Paste a transcript or note. Lacuna saves only clear factual statements and shows what
          it kept. Questions and suggestions are not treated as facts.
        </p>
      </div>

      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="What is this, for example Platform standup, 12 March"
        maxLength={120}
        style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px',
          padding: '10px 13px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px', outline: 'none',
        }}
      />

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="speaker: what they said, one line each"
        rows={6}
        maxLength={MAX_SOURCE}
        style={{
          background: 'transparent', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '8px',
          padding: '11px 13px', color: '#FFFFFF', fontFamily: MONO, fontSize: '12px',
          outline: 'none', resize: 'vertical', lineHeight: 1.6,
        }}
      />

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ ...note, color: text.length > MAX_SOURCE * 0.9 ? '#FFB829' : '#7A7A7A' }}>
          {text.length} / {MAX_SOURCE}
        </span>
        <button
          className="hv-text"
          disabled={state === 'working' || title.trim() === '' || text.trim() === ''}
          onClick={() => void submit()}
          style={{
            background: 'none',
            cursor: state === 'working' ? 'default' : 'pointer',
            borderRadius: '7px',
            padding: '8px 14px',
            fontFamily: MONO,
            fontSize: '10px',
            letterSpacing: '0.12em',
            border: '1px solid rgba(128,82,255,0.55)',
            color: state === 'working' ? '#7A7A7A' : '#FFFFFF',
          }}
        >
          {state === 'working' ? 'READING AND STORING…' : 'ADD TO MEMORY'}
        </button>
        {problem === null ? null : (
          <span style={{ fontSize: '13px', color: '#FFB829', maxWidth: '60ch' }}>{problem}</span>
        )}
      </div>

      {report === null ? null : (
        <div style={{ border: '1px solid rgba(128,82,255,0.35)', borderRadius: '9px', padding: '13px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ ...note, color: '#B79BFF' }}>STORED · {report.sourceKey}</span>
          <span style={{ fontSize: '14px', color: '#FFFFFF' }}>
            {report.claims} claim{report.claims === 1 ? '' : 's'} over {report.entities} subject
            {report.entities === 1 ? '' : 's'}, from {report.turns} turn{report.turns === 1 ? '' : 's'}.
          </span>
          <span style={{ ...note }}>
            {report.accepted} RECORDS ACCEPTED · {report.ms}MS
            {report.refused.length > 0 ? ` · ${report.refused.length} REFUSED` : ''}
            {report.truncated ? ' · TEXT WAS CUT AT THE LIMIT' : ''}
          </span>
          <span style={{ fontSize: '13px', color: '#9A9A9A', maxWidth: '70ch', lineHeight: 1.55 }}>
            Your memory may take a few seconds to become searchable.
          </span>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', marginTop: '3px' }}>
            <span style={{ fontSize: '13px', color: '#9A9A9A', maxWidth: '62ch', lineHeight: 1.55 }}>
              Want to use this memory from another app? Open MCP setup to create a private access key.
            </span>
            <button type="button" onClick={() => go('/app/tools')} style={{ background: 'none', border: '1px solid rgba(128,82,255,0.55)', borderRadius: '6px', color: '#FFFFFF', cursor: 'pointer', padding: '7px 10px', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.12em' }}>OPEN MCP SETUP</button>
          </div>
        </div>
      )}
    </div>
  );
}
