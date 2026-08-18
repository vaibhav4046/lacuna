# The demo journey

One path through the product, six steps, told in the same order everywhere: the
landing page's example questions, the video's shots, and the submission form's
"what was built" answer all follow this sequence. A judge who has seen one
surface recognises the other two.

Every value on this page was re-run against a live node on 2026-08-18 with the
CLI, exit 0 each time. The corpus is deterministic (seed `lacuna-demo-v1`), so
the same commands produce the same claim ids, quotes and session names on any
machine.

## Step 1. A fact is stated early

In the session "Trust weekly sync", among 5,246 messages across 72
sessions, one message states:

> "I had the notes for Bellwether open going into this. The beta partner for
> Bellwether is Stonecrop. No other decisions came out of that part."

That becomes claim `#2475749815969757`, valid from 2025-04-12. Around it the
corpus does what real chat history does: "Stonecrop" appears in 46 messages,
and 41 of them state nothing at all ("Nothing new on Stonecrop this week, we
are waiting on the review", "We skipped Stonecrop today, the owner was not on
the call"). Any retriever that ranks by mention frequency drowns here. That is
deliberate.

## Step 2. Later sessions correct it, and the old values stay

Two corrections arrive in later sessions, days apart:

> "Correction on Bellwether: the beta partner is now Millbrace."
> — "Payments vendor review", 2025-04-18

> "Correction on Bellwether: the beta partner is now Halverd."
> — "Data planning call", 2025-04-20

Neither correction deletes anything. Each writes a new claim and a
`SUPERSEDES` edge; the old value stays indexed and queryable, which is exactly
the situation the track brief names: "track information that was later
overwritten."

## Step 3. Ask, and get the current value with its chain

```
$ lacuna ask Bellwether beta_partner
Q  Bellwether beta_partner
A  Halverd
   This replaced 2 earlier values and nothing has superseded it.

   Cited from
     Data planning call, 2025-04-20, user
       "Correction on Bellwether: the beta partner is now Halverd."
```

The answer is the current value, the explanation says it replaced two earlier
ones, and the citation is the correcting quote itself. `lacuna timeline` shows
the whole chain, oldest first:

```
claim              valid from    value      state
#2475749815969757  2025-04-12    Stonecrop  superseded by #2247326196671333
#2247326196671333  2025-04-18    Millbrace  superseded by #797564529472318
#797564529472318   2025-04-20    Halverd    current, answered with this
```

## Step 4. A question that needs a hop

"Who is our contact for the vendor behind replay-queue?" is answerable, but no
single message answers it. Two messages in two different sessions each hold
half:

> "replay-queue is supplied by Northfold." — "Growth operations check-in", 2025-05-04

> "Our contact at Northfold is Farah Haddad." — "Platform operations check-in", 2025-05-06

```
$ lacuna ask replay-queue contact --via vendor
A  Farah Haddad
   Followed "vendor" to Northfold (entity 1635203334682294, through claim 4026755961307662)
```

The output names the bridge: which relation was followed, to which entity,
through which claim. Both halves are cited. A two-hop answer that does not show
its bridge is not checkable.

## Step 5. A question the history never answered

"When is the migration window for Meridian?" Nothing in the 72 sessions ever
stated one.

```
$ lacuna ask Meridian migration_window
A  No answer (never_stated)
   No answer given, because nothing in the sessions ever stated this.
```

The refusal carries a machine-readable reason code, one of five, each decided
by the shape of the graph rather than a confidence threshold:

| Code | The graph shape that triggers it |
|---|---|
| `never_stated` | The subject exists, no claim on that predicate |
| `retracted` | A claim existed and was withdrawn |
| `contradicted` | Two unsuperseded claims disagree |
| `unconnected` | Both pieces exist, the link between them was never stated |
| `out_of_scope` | The subject has no node in the graph at all |

This is the track brief's hardest ask: "knowing when the answer simply is not
in the history and saying so instead of inventing one."

## Step 6. The same answers on every surface

The three questions above return the same status, answer, claim id, evidence
ids and reason code through the web UI, the CLI and the MCP server, because
all three call the same `askCore` projection in
[src/contract/result.ts](../src/contract/result.ts). `npm run parity` proves
it by sweeping all sixty-four gold questions through the three surfaces and
comparing field by field; the saved run ends `SWEEP_IDENTICAL: 64 of 64` and
`ALL_IDENTICAL: True`
([artifacts/verification/2026-08-18/parity.txt](../artifacts/verification/2026-08-18/parity.txt)).

## Why these three questions

The journey uses one question of each hard kind: a fact that was overwritten
twice, a fact that needs a traversal, and a fact that was never stated. The
other 61 gold questions cover these plus the remaining kinds (stable,
retracted, contradicted, unconnected, out_of_scope, blast_radius); `npm run eval`
runs all sixty-four and the committed benchmark scores them 64/64 with zero
false answers. These three
are the demo because each one is a place where retrieval-by-similarity has no
mechanism: ranking cannot know Stonecrop was superseded, cannot join two
halves of a hop it retrieved separately, and cannot say "no" for a structural
reason.
