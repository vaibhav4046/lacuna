import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { MONO } from '../design/mark';
import { postFor } from '../api/client';

/**
 * The claim on this page, tested on this page.
 *
 * Everything above and below is an argument. This is the one place the reader
 * can check it, against the real store, without an account and without leaving
 * the landing. A page that says "memory that knows what changed" and then makes
 * you sign up to find out is asking to be disbelieved.
 *
 * The three prompts are not decoration and they are not the only ones that
 * work: they are three of the five outcomes the resolver can reach, chosen
 * because each is a different kind of answer. A visitor who clicks all three
 * has seen a live value, a disagreement nothing resolved, and a fact that was
 * taken back, which is the entire argument in about fifteen seconds.
 *
 * The reading is rendered because the question is parsed before it is answered,
 * and a parser that guessed wrong would otherwise show a fully evidenced answer
 * to a question nobody asked.
 */

const PROMPTS: readonly string[] = [
  'what does token-forge depend on?',
  'who is the runbook owner for billing-gate?',
  'when does Lowbank launch?',
];

/** What an abstention means, in the reader's language rather than the enum's. */
const NO_ANSWER: Readonly<Record<string, string>> = {
  never_stated: 'Nothing here ever stated that. It is absent, not unknown.',
  contradicted: 'Two sources disagree and nothing resolved it. Both stay visible.',
  retracted: 'It was stated and then taken back, so there is no current value.',
};

interface Reply {
  readonly reading: { readonly subject: string; readonly predicate: string } | null;
  readonly unread: string | null;
  readonly knownSubjects: readonly string[];
  /** The whole request, not just the resolve. See PlannedAnswer.ms. */
  readonly ms: number;
  readonly answer: {
    readonly status: string;
    readonly answer: string | null;
    readonly abstain_reason: string | null;
    readonly evidence: readonly { readonly source: string; readonly standing: string }[];
    } | null;
}

export function Try() {
  const go = useNavigate();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply | null>(null);

  async function ask(question: string) {
    setText(question);
    setBusy(true);
    setReply(null);
    const got = await postFor<Reply>('/api/explore/query', { question });
    setReply(got ?? { reading: null, unread: 'unreachable', knownSubjects: [], ms: 0, answer: null });
    setBusy(false);
  }

  const answer = reply?.answer ?? null;

  return (
    <section id="try" data-scene="try" style={{ position: 'relative', padding: '18vh 20px 16vh' }}>
      <div style={{ maxWidth: '760px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h2 style={{ fontSize: 'clamp(32px, 3.6vw, 56px)', fontWeight: 400, lineHeight: 1.05, letterSpacing: '-0.035em', margin: 0, color: '#FFFFFF' }}>
          Ask it something.
        </h2>
        <p style={{ fontSize: '16.5px', color: '#9A9A9A', margin: 0, lineHeight: 1.6, maxWidth: '58ch' }}>
          No account. This reaches the same store, the same resolver and the same evidence the
          signed-in product uses.
        </p>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', border: '1px solid rgba(128,82,255,0.45)', borderRadius: '10px', padding: '13px 16px' }}>
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void ask(text.trim()); }}
            placeholder="who owns token-forge?"
            aria-label="Ask the public workspace a question"
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', color: '#FFFFFF', fontSize: '16px', outline: 'none' }}
          />
          <button
            className="hv-violet"
            onClick={() => void ask(text.trim())}
            disabled={busy || text.trim() === ''}
            style={{ background: '#8052FF', border: 'none', borderRadius: '6px', cursor: busy ? 'default' : 'pointer', fontFamily: MONO, fontSize: '9.5px', letterSpacing: '0.16em', color: '#FFFFFF', padding: '9px 14px' }}
          >{busy ? 'ASKING…' : 'ASK'}</button>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {PROMPTS.map((prompt) => (
            <button
              key={prompt}
              className="hv-text"
              onClick={() => void ask(prompt)}
              style={{ background: 'none', cursor: 'pointer', borderRadius: '7px', padding: '7px 11px', fontFamily: MONO, fontSize: '11px', border: '1px solid rgba(255,255,255,0.13)', color: '#9A9A9A' }}
            >{prompt}</button>
          ))}
        </div>

        {reply === null ? null : reply.reading !== null && answer !== null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '18px' }}>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', fontFamily: MONO, fontSize: '10px', letterSpacing: '0.16em', color: '#7A7A7A' }}>
              <span>READ AS {reply.reading.subject.toUpperCase()} · {reply.reading.predicate.replace(/_/g, ' ').toUpperCase()}</span>
              <span style={{ color: answer.status === 'ANSWERED' ? '#8052FF' : '#FFB829' }}>{answer.status.replace(/_/g, ' ')}</span>
              <span>{reply.ms} MS</span>
            </div>
            <span style={{ fontSize: '20px', color: '#FFFFFF', lineHeight: 1.45 }}>
              {answer.answer ?? NO_ANSWER[answer.abstain_reason ?? ''] ?? 'Nothing here answers that.'}
            </span>
            {answer.evidence.slice(0, 3).map((item, at) => (
              <span key={at} style={{ fontFamily: MONO, fontSize: '11px', color: '#7A7A7A' }}>
                {item.source} · {item.standing.replace(/_/g, ' ')}
              </span>
            ))}
            <button
              className="hv-text"
              onClick={() => go('/explore/ask')}
              style={{ alignSelf: 'flex-start', background: 'none', border: 'none', cursor: 'pointer', fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em', color: '#BDBDBD', padding: '6px 2px', borderBottom: '1px solid rgba(255,255,255,0.25)' }}
            >OPEN THE WHOLE PRODUCT</button>
          </div>
        ) : (
          <span style={{ fontSize: '15.5px', color: '#FFB829', lineHeight: 1.6, maxWidth: '60ch', borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: '18px' }}>
            {reply.unread === 'no_subject'
              ? `Nothing in that names something this workspace holds. It holds ${reply.knownSubjects.slice(0, 5).join(', ')}.`
              : reply.unread === 'no_predicate'
                ? 'That names something it holds, but asks for a property it has no word for.'
                : 'That did not reach the context store.'}
          </span>
        )}
      </div>
    </section>
  );
}
