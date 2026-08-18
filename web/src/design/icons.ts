import type { CSSProperties } from 'react';

/**
 * The design's icon set, ported from ICOS() in Lacuna Product.dc.html.
 *
 * Every glyph is an inline data URI built the way the design builds it, so
 * nothing here is a file, nothing is fetched, and the whole set is covered by
 * img-src 'self' data: without loosening anything. The method memoised itself
 * on the instance; a module constant is what that memoisation becomes when the
 * class goes away, so the cache is the binding.
 *
 * The claude entry is a model provider the product connects to, the same as
 * codex or gitlab. It is product content and it stays.
 */

const w = (s: string): string =>
  'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">' + s + '</svg>');

const ICONS: Record<string, string> = {
  github: w('<path fill="#FFFFFF" d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.97c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.04.77 2.1v3.11c0 .31.21.68.8.56A11.53 11.53 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/>'),
  slack: w('<path fill="#E01E5A" d="M5.04 15.12a2.1 2.1 0 1 1-2.1-2.1h2.1zm1.06 0a2.1 2.1 0 0 1 4.2 0v5.26a2.1 2.1 0 0 1-4.2 0z"/><path fill="#36C5F0" d="M8.88 5.04a2.1 2.1 0 1 1 2.1-2.1v2.1zm0 1.06a2.1 2.1 0 0 1 0 4.2H3.62a2.1 2.1 0 0 1 0-4.2z"/><path fill="#2EB67D" d="M18.96 8.88a2.1 2.1 0 1 1 2.1 2.1h-2.1zm-1.06 0a2.1 2.1 0 0 1-4.2 0V3.62a2.1 2.1 0 0 1 4.2 0z"/><path fill="#ECB22E" d="M15.12 18.96a2.1 2.1 0 1 1-2.1 2.1v-2.1zm0-1.06a2.1 2.1 0 0 1 0-4.2h5.26a2.1 2.1 0 0 1 0 4.2z"/>'),
  notion: w('<rect x="3.8" y="3.8" width="16.4" height="16.4" rx="2.5" fill="none" stroke="#BDBDBD" stroke-width="1.4"/><path fill="#FFFFFF" d="M8.6 8v8h1.5v-5.2L14.1 16h1.3V8h-1.5v5.2L9.9 8z"/>'),
  gmail: w('<path fill="none" stroke="#9A9A9A" stroke-width="1.4" d="M3.2 5.8h17.6v12.4H3.2z"/><path fill="none" stroke="#EA4335" stroke-width="1.8" d="m3.2 7 8.8 6.4L20.8 7"/>'),
  linear: w('<path fill="#5E6AD2" d="M2.63 14.86 9.14 21.37A10.05 10.05 0 0 1 2.63 14.86ZM2.03 12.42 11.58 21.97a10 10 0 0 0 2.4-.29L2.32 10.02a10 10 0 0 0-.29 2.4ZM2.7 8.55 15.45 21.3a9.98 9.98 0 0 0 1.94-1.02L3.72 6.61A9.98 9.98 0 0 0 2.7 8.55ZM4.6 5.16a10 10 0 1 1 14.24 14.24Z"/>'),
  gitlab: w('<path fill="#E24329" d="M12 21.4 8.28 10.2h7.44z"/><path fill="#FC6D26" d="M12 21.4 2.7 14.5a.9.9 0 0 1-.32-1L3.62 10.2h4.66zM12 21.4l9.3-6.9a.9.9 0 0 0 .32-1L20.38 10.2h-4.66z"/><path fill="#FCA326" d="M3.62 10.2 5.16 5.06a.45.45 0 0 1 .86 0l1.54 5.14zM20.38 10.2 18.84 5.06a.45.45 0 0 0-.86 0l-1.54 5.14z"/>'),
  jira: w('<path fill="#2684FF" d="M11.53 2 4.93 8.6a2 2 0 0 0 0 2.83l6.6 6.6 1.42-1.41-6.19-6.19 6.19-6.02z"/><path fill="#2684FF" opacity="0.55" d="M12.47 5.97 18.66 12.16a2 2 0 0 1 0 2.83L12.47 21.18l-1.42-1.41 6.19-6.19-6.19-6.2z"/>'),
  confluence: w('<path fill="#2684FF" d="M2.9 17.6c2.7-4.4 6-5.1 10.6-2.9l5.4 2.5-1.8 3.7-5.3-2.4c-3-1.4-4.5-1-6.1 1.7z"/><path fill="#2684FF" opacity="0.55" d="M21.1 6.4c-2.7 4.4-6 5.1-10.6 2.9L5.1 6.8 6.9 3.1l5.3 2.4c3 1.4 4.5 1 6.1-1.7z"/>'),
  hydra: w('<path stroke="#15846E" stroke-width="1.5" fill="none" d="M12 17.2 5.4 7.6M12 17.2V5.2M12 17.2l6.6-9.6"/><circle cx="12" cy="17.2" r="2.5" fill="#15846E"/><circle cx="5.4" cy="7.6" r="2" fill="#15846E"/><circle cx="12" cy="5.2" r="2" fill="#15846E"/><circle cx="18.6" cy="7.6" r="2" fill="#15846E"/>'),
  files: w('<path fill="none" stroke="#9A9A9A" stroke-width="1.5" d="M6 3.5h7.5L18 8v12.5H6z"/><path fill="none" stroke="#9A9A9A" stroke-width="1.5" d="M13.5 3.5V8H18"/>'),
  api: w('<circle cx="12" cy="12" r="3" fill="none" stroke="#9A9A9A" stroke-width="1.5"/><path stroke="#9A9A9A" stroke-width="1.5" d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>'),
  claude: w('<path stroke="#D97757" stroke-width="1.9" stroke-linecap="round" d="M12 3.6v4M12 16.4v4M3.6 12h4M16.4 12h4M6.1 6.1l2.8 2.8M15.1 15.1l2.8 2.8M17.9 6.1l-2.8 2.8M8.9 15.1l-2.8 2.8"/>'),
  codex: w('<path fill="none" stroke="#FFFFFF" stroke-width="1.6" d="M12 3.2 19.6 7.6v8.8L12 20.8 4.4 16.4V7.6z"/><path fill="none" stroke="#FFFFFF" stroke-width="1.2" opacity="0.55" d="M12 7.5 15.9 9.75v4.5L12 16.5 8.1 14.25v-4.5z" transform="rotate(30 12 12)"/>'),
  chip: w('<rect x="7" y="7" width="10" height="10" rx="1.5" fill="none" stroke="#BDBDBD" stroke-width="1.5"/><rect x="10.2" y="10.2" width="3.6" height="3.6" fill="#8052FF"/><path stroke="#BDBDBD" stroke-width="1.5" d="M9.5 7V3.8M14.5 7V3.8M9.5 20.2V17M14.5 20.2V17M7 9.5H3.8M7 14.5H3.8M20.2 9.5H17M20.2 14.5H17"/>'),
  cloud: w('<path fill="none" stroke="#9A9A9A" stroke-width="1.6" d="M6.5 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 16.6 8.9 4.3 4.3 0 0 1 17.5 18z"/>'),
  orb: w('<circle cx="12" cy="12" r="5.2" fill="none" stroke="#FFB829" stroke-width="1.6"/><circle cx="12" cy="12" r="1.6" fill="#FFB829"/><path fill="none" stroke="#FFB829" stroke-width="1.2" opacity="0.5" d="M3 12a9 9 0 0 0 18 0"/>')
};

/** icFor(n) from the design, branch for branch, fallback included. */
export function icFor(n: string): string {
  const I = ICONS, k = (n || '').toLowerCase();
  if (k.includes('github')) return I['github'] as string;
  if (k.includes('gitlab')) return I['gitlab'] as string;
  if (k.includes('slack')) return I['slack'] as string;
  if (k.includes('notion')) return I['notion'] as string;
  if (k.includes('gmail')) return I['gmail'] as string;
  if (k.includes('linear')) return I['linear'] as string;
  if (k.includes('jira')) return I['jira'] as string;
  if (k.includes('confluence')) return I['confluence'] as string;
  if (k.includes('hydra')) return I['hydra'] as string;
  if (k.includes('claude') || k.includes('anthropic')) return I['claude'] as string;
  if (k.includes('codex') || k.includes('openai')) return I['codex'] as string;
  if (k.includes('qwen') || k.includes('ollama') || k.includes('vllm') || k.includes('chip') || k === 'local') return I['chip'] as string;
  if (k.includes('cloud')) return I['cloud'] as string;
  if (k.includes('orb') || k.includes('voice') || k.includes('speech')) return I['orb'] as string;
  if (k.includes('api') || k.includes('webhook') || k.includes('custom') || k.includes('endpoint')) return I['api'] as string;
  return I['files'] as string;
}

/**
 * icStyle(n, s) from the design. The numbers stay numbers: React appends px,
 * which is what the design's own renderer did with them.
 */
export function icStyle(n: string, s: number): CSSProperties {
  return { width: s, height: s, backgroundImage: 'url("' + icFor(n) + '")', backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', flexShrink: 0, display: 'block' };
}
