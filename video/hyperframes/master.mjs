import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The deliverable cut, from the raw render.
 *
 *   node master.mjs
 *
 * The raw render is 80MB of near-lossless frames, which is the right thing for
 * a render and the wrong thing to hand to anybody. This is the step that was
 * previously done by hand, and doing it by hand is why `final-metadata.json`
 * described a 148 second film after the film had grown to 173: the numbers were
 * typed rather than measured. Everything below is measured.
 *
 * Loudness is two pass on purpose. A single pass loudnorm guesses at the
 * material as it streams and lands within about a decibel; the second pass is
 * given the first pass's own measurements and lands on the target. -16 LUFS
 * with a -1.5 dBTP ceiling is what every platform this might be uploaded to
 * asks for, and what the previous master was cut to, so the two are comparable.
 *
 * Captions go in as a real mov_text track rather than burned into the picture,
 * so they can be turned off, and the sidecar .srt stays beside the file for
 * anywhere that wants one.
 */

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const RENDERS = join(ROOT, 'renders');
const SRT = join(RENDERS, 'lacuna-demo.srt');
const OUT = join(RENDERS, 'lacuna-demo-master.mp4');

/** Loudness target. Matches the previous master so the two are comparable. */
const LUFS = -16;
const TRUE_PEAK = -1.5;
const LRA = 11;

/** ffmpeg reports on stderr, including loudnorm's JSON, so both are returned. */
function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr ?? '');
    process.exit(run.status ?? 1);
  }
  return `${run.stdout ?? ''}${run.stderr ?? ''}`;
}

function probe(file, entries) {
  return execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', file,
  ], { encoding: 'utf8' }).trim();
}

/**
 * The newest raw render, rather than a name typed into this file.
 *
 * `hyperframes render` writes a timestamped file every time, so pinning a name
 * here would mean this script silently mastered a stale render the first time
 * somebody re-rendered and forgot to edit it.
 */
const raw = readdirSync(RENDERS)
  .filter((name) => /^hyperframes_.*\.mp4$/.test(name))
  .map((name) => ({ name, at: statSync(join(RENDERS, name)).mtimeMs }))
  .sort((a, b) => b.at - a.at)[0];

if (raw === undefined) {
  process.stderr.write('no hyperframes_*.mp4 in renders/. Run `npm run render` first.\n');
  process.exit(1);
}

const source = join(RENDERS, raw.name);
process.stdout.write(`source   ${raw.name}\n`);

// Pass one measures. Its numbers are the input to pass two, which is the only
// way loudnorm hits the target rather than approaching it.
process.stdout.write('measuring loudness\n');
const analysis = ffmpeg([
  '-i', source,
  '-af', `loudnorm=I=${LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}:print_format=json`,
  '-f', 'null', '-',
]);

const measured = JSON.parse(analysis.slice(analysis.lastIndexOf('{'), analysis.lastIndexOf('}') + 1));
process.stdout.write(`  in ${measured.input_i} LUFS, peak ${measured.input_tp} dBTP\n`);

const normalise = [
  `loudnorm=I=${LUFS}:TP=${TRUE_PEAK}:LRA=${LRA}`,
  `measured_I=${measured.input_i}`,
  `measured_TP=${measured.input_tp}`,
  `measured_LRA=${measured.input_lra}`,
  `measured_thresh=${measured.input_thresh}`,
  `offset=${measured.target_offset}`,
  'linear=true',
  'print_format=summary',
].join(':');

process.stdout.write('encoding\n');
ffmpeg([
  '-y',
  '-i', source,
  '-i', SRT,
  '-map', '0:v:0', '-map', '0:a:0', '-map', '1:0',
  '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', '30',
  '-af', normalise,
  '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
  '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng',
  '-movflags', '+faststart',
  OUT,
]);

// Everything written to the metadata is read back off the finished file. A
// number in there that was not measured is a number that will drift.
const bytes = statSync(OUT).size;
const seconds = Number(probe(OUT, 'format=duration'));
const sha256 = createHash('sha256').update(readFileSync(OUT)).digest('hex');
const narration = JSON.parse(readFileSync(join(ROOT, 'narration.json'), 'utf8'));

const metaPath = join(ROOT, '..', '..', 'artifacts', 'video', 'final-metadata.json');
const existing = JSON.parse(readFileSync(metaPath, 'utf8'));
writeFileSync(metaPath, `${JSON.stringify({
  ...existing,
  sha256,
  bytes,
  seconds: Math.round(seconds * 10) / 10,
  scenes: narration.scenes.length,
}, null, 2)}\n`, 'utf8');

process.stdout.write(`\n${OUT}\n  ${(bytes / 1e6).toFixed(1)} MB · ${seconds.toFixed(1)}s · ${narration.scenes.length} scenes\n  sha256 ${sha256}\n`);
