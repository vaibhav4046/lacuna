import { html } from './html';
import { mastheadCompact, page, panel } from './layout';

/**
 * The page for everything that is not an answer.
 *
 * A product whose subject is honest absence cannot have a stack trace for a 500
 * and a blank screen for a 404. Every one of these says what happened, in the
 * same voice as the rest of the site, and none of them says anything the server
 * has not established: the text comes from a fixed set of notices chosen by the
 * route, never from the request.
 */

export interface Notice {
  /** The status code, printed in the margin where a panel number would be. */
  readonly code: number;
  readonly title: string;
  readonly heading: string;
  readonly lines: readonly string[];
}

export function noticePage(notice: Notice): string {
  return page({
    title: `${notice.title} | Lacuna`,
    description: notice.heading,
    // A refusal is not one of the four pages, so the bar marks none of them.
    current: null,
    body: [
      mastheadCompact(notice.heading),
      panel({
        index: notice.code,
        label: notice.title,
        heading: notice.heading,
        body: [
          notice.lines.map((line) => html`<p class="prose">${line}</p>`),
          html`<p class="prose"><a href="/">Go back to the question form</a>, which lists
a working example of every kind of question this can answer.</p>`,
        ],
      }),
    ],
  });
}
