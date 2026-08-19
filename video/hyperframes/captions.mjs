import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Captions, from the script that was spoken and the clips that were measured.
 *
 *   node captions.mjs
 *
 * Each scene's window is exact: it starts where the composition starts that
 * scene's audio and ends after that clip's measured duration. Within a scene
 * the cues are split by word count, which is an estimate rather than a forced
 * alignment. That is stated here rather than implied, because a caption file
 * that claims word-level timing it does not have is the same kind of small
 * lie this project keeps refusing.
 *
 * whisper.cpp would give real word timings. It is not installed on this
 * machine, and building it to shave a few tenths off cue boundaries was not
 * worth the dependency.
 */

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const narration = JSON.parse(readFileSync(`${ROOT}narration.json`, 'utf8'));
const meta = JSON.parse(readFileSync(`${ROOT}meta.json`, 'utf8'));
const script = readFileSync(`${ROOT}SCRIPT.md`, 'utf8');

const text = new Map();
for (const block of script.split(/^## /m).slice(1)) {
  const [heading, ...rest] = block.split('\n');
  text.set(heading.split('·')[0].trim(), rest.join('\n').trim());
}

const starts = new Map(meta.scenes.map((scene) => [scene.id, scene.start]));
const spoken = new Map(narration.scenes.map((scene) => [scene.id, scene.seconds]));

/** Two lines of readable length, which is what a viewer can take in at once. */
const MAX_WORDS = 11;

function cuesFor(sentence) {
  const out = [];
  for (const part of sentence.split(/(?<=[.?])\s+/)) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    for (let at = 0; at < words.length; at += MAX_WORDS) {
      out.push(words.slice(at, at + MAX_WORDS).join(' '));
    }
  }
  return out;
}

function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3_600_000)).padStart(2, '0');
  const m = String(Math.floor(ms / 60_000) % 60).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
}

const lines = [];
let index = 0;

for (const scene of meta.scenes) {
  const body = text.get(scene.id);
  const window = spoken.get(scene.id);
  if (body === undefined || window === undefined) continue;

  const cues = cuesFor(body);
  const words = cues.map((cue) => cue.split(/\s+/).length);
  const total = words.reduce((sum, count) => sum + count, 0);

  let at = starts.get(scene.id);
  cues.forEach((cue, position) => {
    const span = (words[position] / total) * window;
    index += 1;
    lines.push(`${index}\n${stamp(at)} --> ${stamp(at + span)}\n${cue}\n`);
    at += span;
  });
}

writeFileSync(`${ROOT}renders/lacuna-demo.srt`, `${lines.join('\n')}`, 'utf8');
process.stdout.write(`${index} cues written to renders/lacuna-demo.srt\n`);
