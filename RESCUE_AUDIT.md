# Rescue audit

Checkpoint tag: `rescue-pre-v5-design-cutover` at `b4f50fc`.

## The white page at localhost:3016

Reported as "the white localhost page is BROKEN". Reproduced, and it was three
separate faults stacked on the same symptom. All three are fixed.

### 1. The dev server was bound to IPv6 only

    $ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3016/
    000
    $ curl -o /dev/null -w '%{http_code}' http://localhost:3016/
    200
    $ curl -o /dev/null -w '%{http_code}' 'http://[::1]:3016/'
    200

Vite's default `server.host` is the string `localhost`. Node resolves that to
`::1` on this machine and binds there and nowhere else, so every request to
`127.0.0.1:3016` was refused while `localhost:3016` worked. A refused
connection is a white browser error page, which is indistinguishable from a
broken application if you are looking at a screen rather than at a terminal.

Fix: `server.host: '127.0.0.1'` in `web/vite.config.ts`. Both spellings now
answer 200.

### 2. Black was in a stylesheet that only JavaScript could load

`web/index.html` carried no styling at all. Every colour in the product came
from `web/src/styles.css`, which is imported by `main.tsx`, which means it does
not exist until the module graph has been fetched, parsed and executed. The
consequences, in order of how bad they are:

- a white flash on every cold load, before the bundle runs;
- a permanently white page if the bundle fails to parse;
- a permanently white page if a content security policy blocks the script;
- a permanently white page with JavaScript disabled.

Fix: `web/public/boot.css`, linked from the document head. A same-origin
stylesheet paints before any script and needs no `script-src`, no nonce and no
inline style, so it survives the strict policy this application ships with. It
sets the black background, the text colour, the font stack and a full-height
root, and it carries the recovery styles below.

### 3. Nothing rendered when rendering failed

React unmounts the entire tree when a render throws, and an unmounted tree is a
blank body. There was no boundary and no `<noscript>`.

Fix: `web/src/app/Recovery.tsx`, an error boundary wrapping the router, and a
`<noscript>` block in `index.html`. Both render a black page with a plain
sentence saying what happened. Neither is ever white.

### Smoke gates

`npm run smoke:web` checks the HTTP-observable half on a running server, and
fails with a named gate rather than a stack trace:

1. `GET /` returns 200 on 127.0.0.1 and on localhost.
2. The served document contains the root element.
3. The served document links `boot.css` before any script.
4. `boot.css` returns 200 and sets a black background.
5. The document carries a `<noscript>` recovery block.
6. The favicon returns 200.
7. Direct refresh of a deep route returns 200.
8. The document references the application entry module.

The DOM half — mount, hero visible, canvas paints a non-empty first frame, no
uncaught errors — is checked in the browser and recorded in the release gate
document with its evidence.

## Verified after the fix

    GET http://127.0.0.1:3016/           200
    GET http://localhost:3016/           200
    GET http://127.0.0.1:3016/boot.css   200
    GET http://127.0.0.1:3016/app/dash   200
    GET http://127.0.0.1:3016/signin     200
    GET http://127.0.0.1:3016/favicon.svg 200
    GET http://127.0.0.1:3014/api/session 200

In the browser at 1440x900: `html` and `body` compute to `rgb(0, 0, 0)`,
`boot.css` is in `document.styleSheets`, the hero reads "Memory that knows /
what changed.", 28 `[data-scene]` sections are present, the `<noscript>` block
is in the document, and the console has no errors on a clean load.

## Subsystem classification

Run, not remembered. Commands and exact results are in the release gate
document; this is the summary.

| Subsystem | State | Evidence |
| --- | --- | --- |
| Landing page port | PROVEN WORKING | measured identical to the oracle at 1280x800, 28 scenes |
| Auth screens | PROVEN WORKING | measured identical to the oracle, sign in and reset |
| Auth backend | PROVEN WORKING | 15 tests over a real socket, every status exercised |
| Onboarding | PARTIAL | screens ported and wired; HydraDB step reads the live doctor |
| App shell | PARTIAL | sidebar, header and dashboard body; 17 route bodies missing |
| App route bodies | MISSING | 1 of 18 ported |
| Memory Gravity Field | MISSING | canvas element mounts at the right place, engine not ported |
| Voice orb | MISSING | not started |
| Workspace API | MISSING | dashboard panels call endpoints that do not exist yet |
| HydraDB adapter | PROVEN WORKING | census matches the plan exactly after re-ingest |
| Temporal, contradiction, abstention | PROVEN WORKING | 936 unit and 77 contract tests green |
| Blast traversal | PROVEN WORKING | in the contract suite |
| MCP stdio | UNVERIFIED | parity last run green; the reported failure is not reproduced yet |
| CLI | PARTIAL | six commands shipped, thirteen designed |
| Evaluations | PROVEN WORKING | artifacts on disk, no unmeasured number published |
| Deployment | UNVERIFIED | old shell still live; no preview for the new frontend yet |
