# V10 production acceptance evidence

Captured on 2026-08-21 against <https://lacuna-five.vercel.app> after deployment
`dpl_5kpU5GECQDi6UK71JjZp4Kj1q1in` reached `READY` and the production alias
moved to it.

## Accepted gates

| Gate | Result |
| --- | --- |
| Root typecheck | passed |
| Unit suite | 83 files, 1,374 tests passed |
| Production build | 124 modules transformed; zero dependency vulnerabilities reported by the Vercel build |
| Web smoke | 9/9 |
| Demo/API smoke | 30/30; 174 memory rows; all six temporal outcome checks live |
| Google OAuth boundary | 15/15; the proof stops before the human account chooser |
| ChatGPT public connector | health, ask, timeline, explain, sentence read, search and fetch accepted against HydraDB Cloud |
| Governed agent | adversarial run completed all eight stages; both conflicting owners and their evidence reached the Context Pack; Reviewer accepted zero unsupported claims; no authoritative writeback |
| Route audit | 198/198 normal and 198/198 reduced motion; 22 routes × 9 viewports; zero console errors, exceptions, failed requests or overflow |
| Landing visual audit | 8 viewports; 25 semantic scenes; 17/17 distinct stage frames; 6/6 reduced-motion effects; clean |
| Vercel runtime errors | no clusters in the two-hour release window |
| Vercel error/fatal logs | none in the two-hour release window |

The ChatGPT result summary is in
[chatgpt-public-connector.json](chatgpt-public-connector.json). The OAuth boundary
summary is in [google-auth-boundary.txt](google-auth-boundary.txt).
The repaired live agent result is in [agent-conflict-run.json](agent-conflict-run.json).

## Boundaries that did not pass

- The installed private ChatGPT connector carried a legacy version-1 workspace
  capability. Production rejected it with HTTP 401 after the version-2,
  30-day-expiring security migration. A signed-in owner must mint and reconnect
  a new capability before private `remember` is accepted in ChatGPT.
- Google returned the real account chooser. Automated selection of an identity
  was intentionally not performed, so this run does not claim a completed fresh
  Google account callback.
- No Claude product was used in this evidence set.
- Production voice remains fail-closed without server-side provider credentials;
  typed Ask remains available.

No bearer, session cookie, provider identifier, email address or secret is
stored in this directory.
