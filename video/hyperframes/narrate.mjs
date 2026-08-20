import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Recreates the single narration source used by the judges master.
 *
 *   node narrate.mjs
 *
 * The exact script lives in narration.txt. The selected professional clone is
 * fixed here so this helper cannot silently fall back to a stock voice. The
 * ElevenLabs key is read from the repository's gitignored .env.local and is
 * never printed. An existing narration file is preserved.
 */

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const OUT = `${ROOT}assets/narration-vaibhav`;
const AUDIO = `${OUT}/lacuna-v8-vaibhav.mp3`;
const VOICE = 'GAeq3X4y41cIseBkBfsS';
const SELECTED_VOICE = 'Vaibhav Lalwani Professional';
const MODEL = 'eleven_multilingual_v2';
const OUTPUT_FORMAT = 'mp3_44100_128';

if (!existsSync(AUDIO)) {
  const env = Object.fromEntries(
    readFileSync(`${ROOT}../../.env.local`, 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
  );
  const key = env.ELEVENLABS_API_KEY;
  if (!key) {
    process.stderr.write('ELEVENLABS_API_KEY is not in .env.local\n');
    process.exit(2);
  }

  const text = readFileSync(`${ROOT}narration.txt`, 'utf8').trim();
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=${OUTPUT_FORMAT}`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: MODEL }),
    },
  );
  if (!response.ok) {
    process.stderr.write(`ElevenLabs answered ${response.status}\n`);
    process.exit(3);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(AUDIO, Buffer.from(await response.arrayBuffer()));
}

const seconds = Number(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', AUDIO,
], { encoding: 'utf8' }).trim());
const sha256 = createHash('sha256').update(readFileSync(AUDIO)).digest('hex').toUpperCase();

writeFileSync(`${ROOT}narration.json`, `${JSON.stringify({
  provider: 'ElevenLabs',
  selectedVoice: SELECTED_VOICE,
  voiceId: VOICE,
  model: MODEL,
  outputFormat: OUTPUT_FORMAT,
  status: 'generated_and_wired',
  durationSeconds: seconds,
  audio: 'assets/narration-vaibhav/lacuna-v8-vaibhav.mp3',
  sha256,
  productVoiceRoundTrip: 'acceptance_pending_server_key',
}, null, 2)}\n`);

process.stdout.write(`${SELECTED_VOICE}: ${seconds.toFixed(6)}s, SHA256 ${sha256}\n`);
