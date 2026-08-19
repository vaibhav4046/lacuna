# External audit, reconciled against HEAD

An independent audit inspected the deployed product and the repository. This
file reconciles every finding against the code as it actually is, rather than
against the commit the audit read.

The rule followed for each one: reproduce it here first, classify it, fix only
what is still real, test it, and check the fix in production. A finding that
turned out to be already fixed is recorded as such rather than quietly
re-fixed, and one finding was wrong in a way worth writing down.

Reconciliation began at `615cbbb`.

| # | Finding | Status | Fixed at |
|---|---|---|---|
| 1 | Evidence standing derived from request outcome | STILL_BROKEN | `f4f4e8e` |
| 2 | Correction does not supersede | STILL_BROKEN | `d8e0ade` |
| 3 | "not documented" becomes a value | STILL_BROKEN | `d8e0ade` |
| 4 | Negation heads an entity name | FOUND WHILE REPRODUCING | `d8e0ade` |
| 5 | Client input errors reported as SYSTEM_ERROR | STILL_BROKEN | `021bb6e` |
| 6 | 32-bit `Math.random` trace ids | STILL_BROKEN | `021bb6e` |
| 7 | Transcript sent in a GET query string | STILL_BROKEN | `021bb6e` |
| 8 | Animated LISTENING with no microphone | PARTIALLY_FIXED | `c6bb622` |
| 9 | Password reset promises an email | STILL_BROKEN | `c6bb622` |
| 10 | Memory search implies it covers 174 rows | STILL_BROKEN | `c6bb622` |
| 11 | Deployment described as a recorded snapshot | ALREADY_FIXED in README, STILL_BROKEN in submission text | `d21bc64` |
| 12 | Unstated HydraDB edges are gap detection | AUDIT_FALSE_POSITIVE, and the correction is the strongest result here | `615cbbb` |

---

## 1. Evidence standing was a property of the request, not of the claim

**Audit claim.** `src/api/workspace.ts` derives every evidence item's standing
from whether the whole request answered.

**Reproduction.** The line was there at `615cbbb`:

```ts
standing: standingOf(core.status === 'answered', false)
```

**Status.** STILL_BROKEN.

**Root cause.** An unresolved contradiction does not answer, so
`core.status === 'answered'` is false and every source of it was labelled
`superseded`. That asserts each of the two claims replaced the other, which is
the opposite of what a contradiction is and is the single case this product
exists to get right. A withdrawal was mislabelled the same way: the live
withdrawing claim read as history.

**Fix.** Standing is now read off the claim graph in the shared core
(`src/contract/result.ts`), which already receives `resolution.considered`
carrying `supersededBy` and polarity per claim. Five canonical standings:
`current`, `current_conflicting`, `superseded`, `withdrawal_current`,
`proposal`. The envelope also gained `claim_id`, `quote` and `observed_at`, so
two sources of one claim can be told from two claims that disagree.

Because it lives in the core, the web, the CLI and the MCP server get the same
answer without any of them knowing about the others. The MCP unit test failed
on the new field the moment it appeared, which is the cross-surface parity
working rather than being asserted.

**Test.** `tests/unit/evidence-standing.test.ts`, nine cases including both
sides of a contradiction, both sides of a withdrawal, and a claim the resolver
never weighed.

**Commit.** `f4f4e8e`.

---

## 2 and 3. The two extractor semantics failures

**Audit claim.** Two sentence shapes are read wrongly.

**Reproduction.** Both were run against `615cbbb` before anything was changed:

```
### CASE 1 correction
   [EXPLICIT_STATE] Sessions | storage = "Redis"    supersedes=null
   [EXPLICIT_STATE] Sessions | storage = "Postgres" supersedes=null

### CASE 2 negative knowledge
   [EXPLICIT_STATE] connection | pool_size = "not documented" supersedes=null
```

**Status.** Both STILL_BROKEN.

**Root cause, case 1.** The correction markers covered the apology form ("I was
wrong") and not the contrast form. "Actually sessions are stored in Postgres,
not Redis" classified as a plain statement, so it filed beside the Redis claim
and the subject held two live values that disagreed, with no correction in the
history.

A second defect sat behind it. Once the mode was fixed, the swap reading
produced the object text `"stored in Postgres"`, because the swap form has no
way to know where the value starts. Where a frame matches, the frame does.

**Root cause, case 3.** "The connection pool size is not documented" is a true
sentence about the documentation. Filed as state it answers "what is the pool
size" with "not documented", which is a false fact wearing the clothes of a
real one. This is the worse of the two: an abstention is visibly an absence,
and a value that reads like an answer is not.

**Fix.** A trailing `, not X` and a leading `actually` / `in fact` now read as
`CORRECTION`, and the frame reading wins over the swap reading when both apply.
`ABSENCE` joins the assertion modes and is decided once the value is known
rather than from the sentence, so the claim keeps its span and no question
about the value can reach it.

**Test.** `tests/unit/extract-semantics.test.ts`, 18 cases covering the audit's
list: `Actually X is B, not A`, `X is not A`, `X is unknown`, `X is not
documented`, `We have not decided X`, `No owner is assigned`, `We should move X
to B`, `Should we move X to B?`, `X was retracted`, correction by another
speaker, correction many turns later, and a prompt injection sentence.

**Production proof.** `POST /api/demo/extract` on the deployment:

```
EXPLICIT_STATE Sessions storage = Redis
CORRECTION     Sessions storage = Postgres   REPLACES
```

**Commit.** `d8e0ade`.

---

## 4. An entity called "No"

Not in the audit. Found while building the regression corpus for finding 3.

"No owner is assigned to checkout." produced
`[EXPLICIT_STATE] No | owner = "assigned to checkout"`: an entity named "No",
carrying a fact about nothing. Negation determiners cannot head a name now.
Recorded because it is the same class as finding 3 and was one sentence away
from it.

**Commit.** `d8e0ade`.

---

## 5, 6 and 7. Requests, traces and transcripts

**Status.** All three STILL_BROKEN.

**5.** An empty subject was a string, so it passed the router's type check,
reached the resolver, failed there, and came back as `SYSTEM_ERROR`. The screen
renders that as "the context store did not answer", which tells somebody their
memory is broken when what happened is that they submitted an empty box, and
makes every real HydraDB failure less believable. Malformed questions are now
`422 INVALID_REQUEST` with a named reason: `subject_required`,
`predicate_required`, `input_too_long`, `question_unreadable`.

**6.** Trace ids were `Math.floor(Math.random() * 0xffffffff)`. 32 bits collide
at around 77,000 requests, and a trace id is quoted in support and pasted into
logs. Now `randomUUID()`.

**7.** Reader-supplied transcripts travelled in the query string, so a pasted
conversation landed in access logs, proxy caches and browser history. They go
in a POST body now. The route carries its own 16KB cap rather than raising the
4KB one that protects sign in, so a long paste is reported as truncated instead
of refused with a bare status code. GET still serves the built-in transcript,
and a test pins that a URL cannot smuggle text through it.

**Commit.** `021bb6e`.

---

## 8, 9 and 10. Three screens claiming what the backend could not prove

**8. Voice.** PARTIALLY_FIXED at `615cbbb`: the panel already said "VOICE
PROVIDER NOT CONFIGURED", and beside it animated a pulsing dot and the word
LISTENING. No microphone was open, there was no `MediaStreamTrack`, and the
animation claimed a live state. The dot no longer pulses and the panel says
VOICE NOT CONFIGURED.

**9. Password reset.** The endpoint has always answered `501` because no mail
transport is configured, which is honest. The page in front of it said "We will
email a reset link" and offered a Send button, so the only way to discover the
truth was to type an email address and submit it. The page says so up front now
and asks for nothing.

**10. Memory list.** The API sent 40 rows and reported a total of 174, with a
search box between them, so the search looked like it covered the workspace. It
now reports shown, loaded and total separately and states what the search
reached.

**Commit.** `c6bb622`.

---

## 11. The deployment described as a recorded snapshot

**Status.** ALREADY_FIXED in the README, STILL_BROKEN where it mattered most.

An earlier review caught this in `README.md` and it was corrected there.
`docs/SUBMISSION.md` field 5 and `NEEDS_VAIBHAV.md` item 5 were missed, and
those are the text about to be pasted into the submission form. They said the
deployment answers from a recorded snapshot; it answers live from HydraDB
Cloud, which `curl /api/health` shows in one line. Both corrected.

**Commit.** `d21bc64`.

---

## 12. The unstated HydraDB edges

**Status.** AUDIT_FALSE_POSITIVE, and worth more than the findings that were
real.

The ten edges HydraDB reached that Lacuna's claim graph has nothing for were
read as gap detection: relations the store found that this memory had missed.
Reading them one at a time shows every single one is a non-event, a sentence
saying that nothing happened:

```
tenant-router --[deferred]-----> discussion
   "The discussion regarding the tenant-router was deferred."
tenant-router --[queried by]---> trust team
   "The Trust team asked about tenant-router again, but there was nothing to report."
tenant-router --[skipped]------> user
   "The tenant-router project was skipped because the owner was not on the call."
```

They are not gaps. They are what a memory looks like when everything gets
stored, and a retrieval system built over them answers "deferred" when somebody
asks what a service depends on. The difference is the product, and it is now
the first thing the README says and the first thing `/judge` says.

**Commit.** `615cbbb`, with the correction to the audit document's own earlier
reading kept above it rather than deleted.
