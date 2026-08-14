import type { Answer } from '../retrieval/types.js';
import { answerPanel, answerTitle } from './answer.js';
import { graphPanel } from './graph.js';
import { mastheadCompact, page, PROMISE, separator } from './layout.js';
import { proofPanel, type AnswerSource, type NodeIdentity } from './proof.js';
import { timelinePanel } from './timeline.js';

/**
 * One question, answered, in four panels that get progressively harder to fake.
 *
 * The order is the order a sceptic reads in. First the verdict, because that is
 * what was asked for. Then the history of the fact, because a verdict about a
 * value that changed is only honest if the changes are visible. Then the path
 * through the graph, because that is where the verdict came from. Then the
 * queries themselves, because at that point the only remaining question is
 * whether any of this was really read from a database, and the answer to that
 * is a statement you can run.
 *
 * Each panel is built from the same `Answer` object. There is no second source
 * for any panel to drift away from.
 */

export function askPage(
  answer: Answer,
  node: NodeIdentity,
  source: AnswerSource = 'live',
): string {
  return page({
    title: answerTitle(answer),
    description: answer.resolution.explanation,
    // An answer is what the question form produces, so the bar keeps the form
    // marked: this page is that page, further along.
    current: '/',
    body: [
      mastheadCompact(PROMISE),
      answerPanel(answer),
      separator(),
      timelinePanel(answer),
      separator(),
      graphPanel(answer),
      separator(),
      proofPanel(answer, node, source),
    ],
  });
}
