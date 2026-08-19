/**
 * Read the product's own words back, and flag the ones nobody chose.
 *
 * Most of this copy was written once and then edited late, which is when the
 * filler arrives: a verb like "leverage" that carries nothing a shorter word
 * does not, a superlative no measurement stands behind, an em dash dropped
 * where a full stop would have done the work. None of it is false. It just
 * reads like it was generated, and a page whose whole argument is that the
 * system stops rather than guesses cannot afford to sound like a guess.
 *
 * The check is deliberately dumb. A word list, three shape rules, and no model
 * anywhere near it. A lint that argues about taste gets argued with and then
 * switched off; a lint that says line 42 contains the word "seamlessly" is
 * either right or trivially dismissed, and reading it costs ten seconds.
 *
 * Source files are not linted whole. In .ts and .tsx only the string literals
 * and the JSX text nodes are read, because everything around them is colours,
 * class names and identifiers, and a rule about "dynamic ecosystem" has no
 * business firing on a CSS property. The JSX half matters more than it looks:
 * the landing headlines are text nodes, not strings, so a lint that read only
 * quoted literals would scan a few hundred hex codes and miss every sentence a
 * visitor actually sees. Markdown and plain text have no structure worth
 * exploiting, so those are read line by line.
 *
 * Two rules are narrower than the rest. Exclamation marks are only flagged in
 * the shipped interface, since a README may reasonably shout and a product
 * surface almost never should. Sentence length is only measured on the landing
 * copy, where a reader is skimming and a thirty-word sentence is a wall; the
 * docs are read by someone who came looking, and they can take longer ones.
 *
 * Exits non-zero on any finding, so it can be a gate instead of a suggestion.
 *
 *   npx tsx scripts/copy-lint.ts
 *   npx tsx scripts/copy-lint.ts --list
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Which copy a rule is allowed to judge. `all` is everything scanned, `ui` is
 * the shipped interface, `landing` is the marketing page inside it.
 */
type Scope = 'all' | 'ui' | 'landing';

/** Longest sentence the landing page gets before it counts as a wall. */
const MAX_SENTENCE_WORDS = 32;

const EM_DASH = '\u2014';

/**
 * The words. Every one of these is either a claim with no measurement behind
 * it, or a longer way of saying something short. They are listed in the order
 * they were collected rather than sorted, because the order records what was
 * actually being written when each one was noticed.
 */
const FILLER: readonly string[] = [
  'leverage',
  'revolutionary',
  'game-changing',
  'game changing',
  'seamless',
  'seamlessly',
  'cutting-edge',
  'cutting edge',
  'unlock the power',
  'supercharge',
  'robust solution',
  'dynamic ecosystem',
  'unparalleled',
  'transformative',
  'next-generation',
  'next generation',
  'reimagining',
  'reimagine',
  'context orchestration',
  'effortless',
  'effortlessly',
  'best-in-class',
  'world-class',
  'harness the power',
  'elevate your',
  'delve',
  'tapestry',
  'testament to',
  "in today's fast-paced",
];

/**
 * One pattern for the whole list, longest phrase first so that "game changing"
 * is reported as itself rather than as a prefix of something shorter. The
 * apostrophe is widened to cover the typographic one, which is what a text
 * editor produces and therefore what the copy actually contains.
 */
const FILLER_PATTERN = new RegExp(
  `\\b(?:${[...FILLER]
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['\u2019]"))
    .join('|')})\\b`,
  'gi',
);

interface Rule {
  readonly id: string;
  readonly scope: Scope;
  readonly why: string;
  /** Every offending fragment in one piece of copy, or nothing. */
  readonly find: (text: string) => readonly string[];
}

const RULES: readonly Rule[] = [
  {
    id: 'FILLER',
    scope: 'all',
    why: 'marketing filler and stock phrasing, listed below',
    find: (text) => [...text.matchAll(FILLER_PATTERN)].map((match) => match[0] ?? ''),
  },
  {
    id: 'EM_DASH',
    scope: 'all',
    why: 'an em dash inside a sentence, where a full stop or a comma reads plainer'
      + ' (a dash standing alone is a placeholder glyph and is left alone)',
    find: (text) => (new RegExp(`\\S[ \\t]*${EM_DASH}[ \\t]*\\S`).test(text) ? [text.trim()] : []),
  },
  {
    id: 'EXCLAMATION',
    scope: 'ui',
    why: 'an exclamation mark in the shipped interface',
    find: (text) => (text.includes('!') ? [text.trim()] : []),
  },
  {
    id: 'LONG_SENTENCE',
    scope: 'landing',
    why: `a landing sentence longer than ${MAX_SENTENCE_WORDS} words`
      + ' (blocks that break across lines are code samples here, and are skipped)',
    find: (text) => (/\n|\\n/.test(text) ? '' : text)
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.split(/\s+/).filter(Boolean).length > MAX_SENTENCE_WORDS),
  },
];

// ---------------------------------------------------------------------------
// What gets read
// ---------------------------------------------------------------------------

interface Source {
  /** Repo-relative, because that is what a person needs in order to open it. */
  readonly path: string;
  readonly scopes: ReadonlySet<Scope>;
  readonly prose: boolean;
}

const CODE_DIRS: readonly { readonly dir: string; readonly landing: boolean }[] = [
  { dir: 'web/src/landing', landing: true },
  { dir: 'web/src/app/routes', landing: false },
  { dir: 'web/src/onboarding', landing: false },
  { dir: 'web/src/auth', landing: false },
];

const PROSE_FILES: readonly string[] = [
  'README.md',
  'social/day7/linkedin.txt',
  'social/day7/x.txt',
];

function collect(): readonly Source[] {
  const sources: Source[] = [];

  for (const entry of CODE_DIRS) {
    const absolute = `${ROOT}${entry.dir}`;
    if (!existsSync(absolute)) continue;
    const scopes: Scope[] = entry.landing ? ['ui', 'landing'] : ['ui'];
    for (const name of readdirSync(absolute, { recursive: true, encoding: 'utf8' })) {
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
      const path = `${entry.dir}/${name.split('\\').join('/')}`;
      if (!statSync(`${ROOT}${path}`).isFile()) continue;
      sources.push({ path, scopes: new Set(scopes), prose: false });
    }
  }

  for (const path of PROSE_FILES) {
    if (!existsSync(`${ROOT}${path}`)) continue;
    sources.push({ path, scopes: new Set<Scope>(), prose: true });
  }

  return sources;
}

// ---------------------------------------------------------------------------
// What counts as copy inside a file
// ---------------------------------------------------------------------------

interface Segment {
  readonly line: number;
  readonly text: string;
}

/**
 * String literals first, then JSX text.
 *
 * Order is load-bearing rather than stylistic: a literal such as `'a > b'`
 * would otherwise be split by the JSX branch and read as a text node. Letting
 * the literal alternatives consume first means a quote always wins, which is
 * also how the language reads it.
 *
 * The JSX branch requires a closing `<` so that a stray angle bracket does not
 * turn the rest of a file into copy, and it refuses a `>` that belongs to `=>`
 * or `>=`. Without that second guard `selected >= 0 && selected !== ci;` reads
 * as a text node, and the lint reports the `!` in a strict inequality as an
 * exclamation mark in the interface, which is the kind of finding that teaches
 * people to stop reading the output.
 *
 * The same class comes back between the arms of a ternary. In
 * `) : !value.available ? (` the `>` closing one element and the `<` opening
 * the next are separated by an expression, which reads as a text node and puts
 * a `!` in front of the reader again. Prose in this product does not contain
 * `) :`, `? (`, `&&`, `||` or `=>`, so a segment carrying one of them is code
 * and is skipped.
 */
const LOOKS_LIKE_CODE = /\)\s*:|\?\s*\(|&&|\|\||=>/;
const SEGMENT_PATTERN = new RegExp(
  [
    "'(?:[^'\\\\\\n]|\\\\.)*'",
    '"(?:[^"\\\\\\n]|\\\\.)*"',
    '`(?:[^`\\\\]|\\\\.)*`',
    '(?<![=!<>-])>(?![=>])[^<>{}]+<',
  ].join('|'),
  'g',
);

function segments(source: Source, content: string): readonly Segment[] {
  if (source.prose) {
    return content
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }))
      .filter((segment) => segment.text.trim().length > 0);
  }

  const found: Segment[] = [];
  for (const match of content.matchAll(SEGMENT_PATTERN)) {
    const raw = match[0] ?? '';
    const text = raw.slice(1, -1);
    if (text.trim().length === 0) continue;
    if (LOOKS_LIKE_CODE.test(text)) continue;
    found.push({ line: content.slice(0, match.index).split('\n').length, text });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const print = (line: string): void => void process.stdout.write(`${line}\n`);

if (process.argv.includes('--list')) {
  print('copy-lint rules\n');
  for (const rule of RULES) {
    print(`  ${rule.id}`);
    print(`    scope  ${rule.scope}`);
    print(`    flags  ${rule.why}\n`);
  }
  print(`  FILLER words and phrases (${FILLER.length}, matched case insensitively)\n`);
  for (const phrase of FILLER) print(`    ${phrase}`);
  print('');
  print('  scopes');
  print('    all      every file scanned');
  print('    ui       web/src/landing, app/routes, onboarding, auth');
  print('    landing  web/src/landing only');
  process.exit(0);
}

interface Finding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly text: string;
}

const sources = collect();
const findings: Finding[] = [];
let scanned = 0;

for (const source of sources) {
  const content = readFileSync(`${ROOT}${source.path}`, 'utf8');

  /**
   * A generated file is a recording, not copy. `cli-session.ts` is a real
   * terminal transcript written by `capture-cli.ts`, so an em dash or a long
   * line in it is evidence of what the CLI printed, and editing it to please a
   * lint would be editing the evidence. The header these files carry is the
   * signal, which means new generated files are covered without a list to keep.
   */
  if (content.slice(0, 200).includes('Do not edit')) continue;

  scanned += 1;
  const applicable = RULES.filter((rule) => rule.scope === 'all' || source.scopes.has(rule.scope));

  for (const segment of segments(source, content)) {
    for (const rule of applicable) {
      for (const offence of rule.find(segment.text)) {
        findings.push({ path: source.path, line: segment.line, rule: rule.id, text: offence });
      }
    }
  }
}

/** One line per finding, in the order a person would walk the files. */
const width = Math.max(0, ...findings.map((finding) => `${finding.path}:${finding.line}`.length));
for (const finding of findings) {
  const where = `${finding.path}:${finding.line}`.padEnd(width);
  print(`${where}  ${finding.rule.padEnd(13)}  ${finding.text}`);
}

print('');
print(`${scanned} files scanned, ${findings.length} findings.`);

process.exit(findings.length > 0 ? 1 : 0);
