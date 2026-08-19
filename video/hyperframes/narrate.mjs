import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Reads SCRIPT.md, speaks each scene, and records what came back.
 *
 *   node narrate.mjs
 *
 * One file per scene rather than one long take: a timing repair on scene nine
 * should not cost the other eleven, and a scene's own duration is what the
 * composition times against. The durations land in narration.json, which the
 * composition builder reads, so the film is cut to the voice rather than the
 * voice squeezed into a guessed layout.
 *
 * The key is read from the repository's gitignored .env.local and never
 * printed. Existing clips are left alone, so a re-run costs nothing and a
 * deleted clip is the way to ask for one line again.
 */

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${ROOT}assets/narration`;
const VOICE = 'JBFqnCBsd6RMkjVDRZzb'; // George, warm and unhurried
const MODEL = 'eleven_multilingual_v2';

const env = Object.fromEntries(
  readFileSync(`${ROOT}../../.env.local`, 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.startsWith('#'))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);

const key = env['ELEVENLABS_API_KEY'];
if (!key) {
  process.stderr.write('ELEVENLABS_API_KEY is not in .env.local\n');
  process.exit(2);
}

const script = readFileSync(`${ROOT}SCRIPT.md`, 'utf8');
const scenes = [];
for (const block of script.split(/^## /m).slice(1)) {
  const [heading, ...rest] = block.split('\n');
  const id = heading.split('·')[0].trim();
  const text = rest.join('\n').trim();
  if (id && text) scenes.push({ id, text });
}

mkdirSync(OUT, { recursive: true });
const manifest = [];

for (const scene of scenes) {
  const file = `${OUT}/${scene.id}.mp3`;
  if (!existsSync(file)) {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: scene.text,
        model_id: MODEL,
        // Steady rather than performed. This is a technical explanation and a
        // narrator doing drama over it would be working against the copy.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.1, speed: 0.98 },
      }),
    });
    if (!response.ok) {
      process.stderr.write(`${scene.id}: the service answered ${response.status}\n`);
      process.exit(3);
    }
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }

  const seconds = Number(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file,
  ], { encoding: 'utf8' }).trim());

  manifest.push({ id: scene.id, seconds: Math.round(seconds * 100) / 100, words: scene.text.split(/\s+/).length });
  process.stdout.write(`${scene.id.padEnd(6)}${String(manifest.at(-1).seconds).padStart(7)}s  ${manifest.at(-1).words} words\n`);
}

const total = manifest.reduce((sum, scene) => sum + scene.seconds, 0);
writeFileSync(`${ROOT}narration.json`, `${JSON.stringify({ voice: VOICE, model: MODEL, scenes: manifest, totalSeconds: Math.round(total * 100) / 100 }, null, 2)}\n`);
process.stdout.write(`\n${manifest.length} scenes, ${Math.round(total)}s of speech\n`);
