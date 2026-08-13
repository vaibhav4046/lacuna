import type { Answer } from '../retrieval/types';
import { answerPanel, answerTitle } from './answer';
import { graphPanel } from './graph';
import { mastheadCompact, page, PROMISE, separator } from './layout';
import { proofPanel, type NodeIdentity } from './proof';
import { timelinePanel } from './timeline';

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

export function askPage(answer: Answer, node: NodeIdentity): string {
  return page({
    title: answerTitle(answer),
    description: answer.resolution.explanation,
    body: [
      mastheadCompact(PROMISE),
      answerPanel(answer),
      separator(),
      timelinePanel(answer),
      separator(),
      graphPanel(answer),
      separator(),
      proofPanel(answer, node),
    ],
  });
}
