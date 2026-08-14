# Verification, 2026-08-14, sixth run

This run measures the deployed copy at <https://lacuna-five.vercel.app> from
the outside, over the public internet, with `curl`. Nothing here ran on the
machine that hosts it. The deployment serves every route from one serverless
function (`api/index.ts`) that answers from the recorded snapshot in
`artifacts/snapshot/graph-snapshot.json`, decoded by the same client code the
live server uses.

## What was run

Every command exited 0. Files are the unedited combined output of the checks.

| File | What it holds |
|---|---|
| `prod-routes.txt` | status code of every route, plus the response headers on `/` |
| `prod-answers.txt` | one grep per answer kind against the live `/ask` HTML, plus the snapshot notice from the home page |
| `snapshot-verify.txt` | tail of `npm run snapshot:verify` run locally against the same snapshot file the deployment ships |

## What the captures show

Routes: `/`, `/bench`, `/hydradb`, `/interface`, `/voice`, `/lacuna.css` and
`/favicon.svg` all answer 200. An unknown path answers 404. `POST /ask`
answers 405; the ask route is GET only.

Headers on `/`: the same Content-Security-Policy the local server sends,
`default-src 'none'; script-src 'none'; style-src 'self'; img-src 'self';
form-action 'self'; base-uri 'none'; frame-ancestors 'none'`, plus
`X-Content-Type-Options: nosniff`. No script runs on any page, deployed or
local.

Answer shapes, one per kind, matching the local gold set:

| Question | Expected in the HTML | Found |
|---|---|---|
| Meridian / launch_date | `25 July 2026` | yes |
| replay-queue / contact via vendor | `Farah Haddad` | yes |
| Junco / launch_date | `Withdrawn, and not replaced` | yes |
| notify-relay / budget_code | `The sessions disagree` | yes |
| Redshank / launch_date | `Not in these sessions` | yes |

The home page carries the disclosure sentence in full: the deployment answers
from a recorded snapshot, every reply was produced by a live HydraDB node at
export time, stored byte for byte, and decoded through the same client code
the live server uses.

`snapshot-verify.txt` is the local replay of all sixty gold questions against
the same snapshot file, ending `60 questions, 0 answer mismatches, 0 wrong
verdicts on replay.`

## What this does and does not prove

It proves the public URL is up, serves every page, refuses what it should
refuse, sends the same security headers as the local server, and returns the
recorded answers for one question of each kind. It does not prove a live
HydraDB node is behind the URL, because there is not one: the deployment is a
replay, and says so on its own pages. The live path remains local only, per
the deployment claim in `docs/CLAIMS.json`.

## Tree state

The working tree at measurement time was commit
`b14b6fc3370f4dfef7927276bc2e1c6cd4bed077` plus the uncommitted deployment
work this run verifies: `api/`, `src/snapshot/`, the snapshot scripts,
`artifacts/snapshot/`, `vercel.json`, `.vercelignore`, and the `.js` import
extension sweep across `src/`, `scripts/` and `tests/`. The deployment was
made from that working tree with `vercel deploy --prod`.

## Secrets

No file in this directory contains a credential. The checks used no token:
the deployed copy needs none, which is the point of the snapshot. A search
for `Bearer`, `HYDRA_TOKEN` and `authorization` across the directory returns
nothing.
