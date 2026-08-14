import { readFileSync } from 'node:fs';

/**
 * A very small .env reader.
 *
 * The repository already keeps HydraDB settings in a gitignored `.env.local`,
 * and scripts/ask.ts loads it through `process.loadEnvFile`. The CLI cannot use
 * that call: it throws when the file is absent, and a CLI that dies because an
 * optional file is missing is worse than one that reads its settings from the
 * real environment. So the file is parsed here instead, and no dotenv package is
 * added for eight lines of splitting.
 *
 * Values already present in the environment win. A shell that exported
 * HYDRA_TOKEN for one command should not be silently overruled by a file.
 *
 * What it does not do: no variable expansion, no multi-line values, no stripping
 * of trailing `#` comments. A token can contain a `#`, and quietly truncating a
 * secret at one would produce an authentication failure with no visible cause.
 */

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseEnvText(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, '').trim();
    if (line === '' || line.startsWith('#')) continue;

    const body = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = body.indexOf('=');
    if (equals <= 0) continue;

    const key = body.slice(0, equals).trim();
    if (!KEY_PATTERN.test(key)) continue;

    values[key] = unquote(body.slice(equals + 1).trim());
  }
  return values;
}

function unquote(value: string): string {
  const quoted = value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'")));
  if (!quoted) return value;

  const inner = value.slice(1, -1);
  // Only the double-quoted form gets escape handling, which is what every other
  // reader of this format does.
  return value.startsWith('"') ? inner.replace(/\\n/g, '\n') : inner;
}

/**
 * Applies a .env file to an environment map. Returns false when the file is not
 * there, which is a normal state rather than a failure.
 */
export function loadEnvFile(
  path: string | URL,
  env: Record<string, string | undefined> = process.env,
): boolean {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const [key, value] of Object.entries(parseEnvText(text))) {
    if (env[key] === undefined) env[key] = value;
  }
  return true;
}
