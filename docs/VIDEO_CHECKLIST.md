# Recording checklist

> Historical pre-V10 capture checklist. Use
> [V10_VIDEO_PITCH.md](V10_VIDEO_PITCH.md) for the current cut, capture order
> and final media gates. Do not mark the rejected V8 film complete from the
> boxes below.

Print this, or keep it on a second screen. Every line is checkable in seconds,
and every on-screen string below was verified against the running server on
2026-08-15. The narration and shot directions live in
[VIDEO_SCRIPT.md](VIDEO_SCRIPT.md); this page is only the boxes to tick.

## Before the first take

- [ ] `scripts/hydra-node.sh start` — node up.
- [ ] `npm run ingest` — exits 0.
- [ ] `npm run census` — last line reads `graph matches the plan exactly`.
- [ ] `npm run serve` — answering on `127.0.0.1:3014`.
- [ ] Open `/ask?subject=Bellwether&predicate=beta_partner`: timeline reads
      Stonecrop, then Millbrace, then Halverd. Wrong order means wrong graph;
      stop and rebuild before recording anything.

## Capture setup

- [ ] Window 1920x1080, page zoom 125%.
- [ ] Bookmarks bar hidden, extension icons hidden.
- [ ] URL bar visible and reading `127.0.0.1:3014`.
- [ ] Cursor visible.
- [ ] No music track armed anywhere.

## Never in frame, checked before pressing record

- [ ] No terminal showing `.env.local`, `HYDRA_TOKEN`, or any variable's value.
- [ ] No file manager or editor tab exposing a home-directory path.
- [ ] No admin port, no curl command carrying a bearer token.

## Per shot, the string that must be on screen

| Shot | Page | Confirm before moving on |
|---|---|---|
| 1 | `/` top | "Memory that knows what changed, what remains true, and what was never known." |
| 2 | `/` at `03 Corpus` | 72 sessions · 5,246 messages · 174 claims · 86 entities · 117,041 estimated tokens |
| 3 | Bellwether answer | **Halverd**, then "This replaced 2 earlier values and nothing has superseded it." |
| 4 | same page, `04 Proof` | Four reads, Cypher printed whole, version and pinned commit at the bottom |
| 5 | Meridian answer | **Never stated.**, then NOTHING WAS EVER STATED HERE, then NO PATH TO ANY STATEMENT |
| 6 | replay-queue answer | **Farah Haddad**, trace line "Followed "vendor" from "replay-queue" to "Northfold"", two quotations |
| 7 | `docs/BENCHMARKS.md` | Opens "The headline is a tie." |
| 8 | `/` top | Same hero as shot 1 |

Two numbers never spoken aloud: any millisecond figure, any claim ID.
Shot 6: do not scroll to its proof panel (eight reads; shot 4 said four).

## After the last take

- [ ] Watched once at full length with a stopwatch: under 3:00.
- [ ] Watched once with sound off, looking only for a token, a home path, or a
      private tab title.
- [ ] Uploaded unlisted, not private, not Drive-with-permissions.
- [ ] Link opened in a logged-out browser before it goes anywhere near the form.
