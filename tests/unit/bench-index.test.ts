import { describe, expect, it } from 'vitest';

import { buildIndex, tokenize } from '../../src/bench/index-corpus';
import type { Corpus, Message, Session } from '../../src/corpus/types';
import { claim } from '../support/bench-fixtures';

/**
 * The flat view of the corpus that every baseline reads.
 *
 * Two things are load bearing here and are tested for that reason. The ordinal
 * has to be a total order over the whole corpus, because a ranking is a list of
 * ordinals and the system layer indexes straight into the array with them. And
 * the tokenizer has to be dull, because a tokenizer with opinions is where a
 * comparison quietly starts favouring one baseline.
 */

function corpusMessage(over: Partial<Message> = {}): Message {
  return {
    key: 'm-1',
    sessionKey: 'session-1',
    index: 0,
    speaker: 'user',
    timestamp: '2026-01-01T00:00:00.000Z',
    text: 'Meridian ships in July.',
    claims: [],
    spans: [],
    ...over,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    key: 'session-1',
    title: 'Planning',
    startedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
    ...over,
  };
}

function corpusOf(sessions: readonly Session[]): Corpus {
  return {
    seed: 'test',
    sessions,
    questions: [],
    entities: [],
    stats: { sessions: sessions.length, messages: 0, claims: 0, characters: 0, estimatedTokens: 0 },
  };
}

describe('tokenize', () => {
  it('lowercases and splits on anything that is not a letter or a digit', () => {
    expect(tokenize('Meridian ships 2026-07-25!')).toEqual(['meridian', 'ships', '2026', '07', '25']);
  });

  it('drops single character tokens, which carry no retrieval signal', () => {
    expect(tokenize('a v2 x 10')).toEqual(['v2', '10']);
  });

  it('splits an accented name at the accent', () => {
    // The character class is ASCII, so "Tomás" indexes as "tom" and a dropped
    // "s". Recorded rather than fixed: every baseline reads the same tokenizer,
    // so this costs them all equally, and a smarter one is a place to help one.
    expect(tokenize('Tomás Herrera')).toEqual(['tom', 'herrera']);
  });

  it('returns nothing for punctuation alone', () => {
    expect(tokenize('  --- ...  ')).toEqual([]);
  });
});

describe('buildIndex', () => {
  it('numbers messages oldest first across sessions, not session by session', () => {
    const index = buildIndex(
      corpusOf([
        session({
          key: 'session-a',
          messages: [
            corpusMessage({ key: 'a1', timestamp: '2026-01-01T00:00:00.000Z', text: 'first' }),
            corpusMessage({ key: 'a2', timestamp: '2026-01-03T00:00:00.000Z', text: 'third' }),
          ],
        }),
        session({
          key: 'session-b',
          messages: [
            corpusMessage({ key: 'b1', timestamp: '2026-01-02T00:00:00.000Z', text: 'second' }),
          ],
        }),
      ]),
    );

    expect(index.messages.map((message) => message.text)).toEqual(['first', 'second', 'third']);
    expect(index.messages.map((message) => message.ordinal)).toEqual([0, 1, 2]);
  });

  it('breaks a timestamp tie on the message key, so the order does not depend on emission', () => {
    const stamp = '2026-01-01T00:00:00.000Z';
    const index = buildIndex(
      corpusOf([
        session({
          messages: [
            corpusMessage({ key: 'm-z', timestamp: stamp }),
            corpusMessage({ key: 'm-a', timestamp: stamp }),
          ],
        }),
      ]),
    );

    expect(index.messages.map((message) => message.key)).toEqual(['m-a', 'm-z']);
  });

  it('carries the session title through, because a citation without one is unreadable', () => {
    const index = buildIndex(
      corpusOf([session({ key: 'session-a', title: 'Vendor review', messages: [corpusMessage()] })]),
    );

    expect(index.messages[0]?.sessionKey).toBe('session-a');
    expect(index.messages[0]?.sessionTitle).toBe('Vendor review');
  });

  it('tokenizes every message once, at index time', () => {
    const index = buildIndex(
      corpusOf([session({ messages: [corpusMessage({ text: 'Meridian ships in July.' })] })]),
    );

    expect(index.messages[0]?.tokens).toEqual(['meridian', 'ships', 'in', 'july']);
  });

  it('collects the subject of every claim', () => {
    const index = buildIndex(
      corpusOf([
        session({
          messages: [
            corpusMessage({ key: 'm-1', claims: [claim({ subject: 'Meridian' })] }),
            corpusMessage({
              key: 'm-2',
              timestamp: '2026-01-02T00:00:00.000Z',
              claims: [claim({ subject: 'replay-queue' }), claim({ subject: 'Meridian' })],
            }),
          ],
        }),
      ]),
    );

    expect([...index.subjects].sort()).toEqual(['Meridian', 'replay-queue']);
  });

  it('does not collect a name that only appears in prose', () => {
    // The subject set is what tells an unheard of entity from a known one with
    // nothing stated. Reading it out of the text instead of the claims would
    // make every name mentioned in passing look like a subject.
    const index = buildIndex(
      corpusOf([session({ messages: [corpusMessage({ text: 'Someone mentioned Halcyon once.' })] })]),
    );

    expect(index.subjects.size).toBe(0);
  });

  it('produces an empty index for an empty corpus', () => {
    const index = buildIndex(corpusOf([]));

    expect(index.messages).toEqual([]);
    expect(index.subjects.size).toBe(0);
  });
});
