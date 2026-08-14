# Needs Vaibhav

Only things that genuinely require the owner: credentials, login approval, paid
actions, irreversible actions, publishing, or an organizer-only clarification.
Everything else gets decided and recorded in [DECISIONS.md](DECISIONS.md)
instead of landing here.

Nothing on this list blocks the build. Independent work continues while these
sit open.

Status values: `open`, `done`, `dropped`.

---

## 1. Hackathon registration (Luma) and Discord

- **Status:** open
- **Why it needs you:** account creation and login. Not something to do on your
  behalf.
- **What to do:** register on the Hack Hydra Luma page and join the Discord. The
  rules say every schedule change, extension and clarification is announced in
  Discord first, so it is also the only channel where a rule change would reach
  us.
- **When:** early. If an extension or a rule clarification lands there, it
  changes planning.
- **Blocking?** No, but it is the single cheapest risk reduction available.

## 2. Push to the public repository

- **Status:** done, 2026-08-13.
- **Where it landed:** <https://github.com/vaibhav4046/lacuna> is public and
  holds the code. The remote tip is `033c1a8`, `git ls-remote` agrees with the
  local `HEAD`, and the GitHub API reports the repository as `private: false`.
- **What it took.** `gh repo create` succeeded, then `git push` was rejected:

  ```
  remote: error: GH007: Your push would publish a private email address.
   ! [remote rejected] main -> main (push declined due to email privacy restrictions)
  ```

  Two exits existed and the account setting was not the one taken. Every other
  public repository on this account already commits under
  `115102797+vaibhav4046@users.noreply.github.com`, and the personal address
  appears in none of them, so clearing `GH007` by publishing it would have created
  a new and permanent exposure that existed for no reason except this hackathon.
  The identity was rewritten across all 42 commits instead. Dates, messages,
  parentage and file content were all verified byte identical on both sides, the
  first commit is still `2026-08-12 21:22:04 +0100`, and the full record with its
  checks is D-050 in [DECISIONS.md](DECISIONS.md). GitHub now reports exactly one
  author address on the repository, the noreply one.
- **Nothing here needs you any more.** The one thing worth knowing is that hashes
  cited in the documentation moved, and D-050 carries the before and after map.
- **Publication safety, cleared before the push and still true.** Each was run
  rather than assumed:
  - 257 blobs across all commits scanned for tokens, private keys and AWS keys.
    Zero hits. The working tree scan is separate and also zero.
  - `.env.example` is the only environment file tracked, and `.gitignore` covers
    `.env`, `.env.local`, `*.pem`, `*.key` and the local database directories.
  - `LICENSE` is Apache-2.0 and committed, which closes one of the seven
    disqualification triggers.
  - First commit is inside the eligibility window, which closes a second, and the
    rewrite preserved that date exactly.
  - Zero Claude or Anthropic attribution anywhere in author fields or messages.

## 3. Demo video

- **Status:** open
- **Why it needs you:** it is your face and voice, and uploading it publishes
  content.
- **What you get from me:** delivered, at [docs/VIDEO_SCRIPT.md](docs/VIDEO_SCRIPT.md).
  Eight shots cut to 2:49, the exact screens and URLs in order, the narration
  written to a measured 158 seconds at 150 words per minute, the commands that
  put the graph in the state every take needs, and a ranked cut list if a take
  runs long. Recording and upload are yours.
- **Hard constraint from the rules:** 3 minutes or less, and "anything past the
  3-minute mark may not be reviewed". Judges must be able to watch it without
  requesting access, so unlisted YouTube is fine, Drive-with-permissions is not.

## 4. Submission form

- **Status:** open
- **Why it needs you:** final submission is irreversible and is your
  confirmation to make.
- **What you get from me:** delivered, at [docs/SUBMISSION.md](docs/SUBMISSION.md).
  All ten fields the form asks for, written out and checked against the code
  rather than from memory, plus a pre-submit checklist. Nine are ready to paste,
  including the repository link, which is now live as well as written:
  <https://github.com/vaibhav4046/lacuna>. The video link (item 3) is the one
  remaining blank.
- **Deadline:** 2026-08-20, 11:59 PM PT. Internal target is 2026-08-19, 21:00
  Europe/London.

## 5. Deployed link, if we want one

- **Status:** done, as a recorded replay
- **What happened:** a copy of the product went public on 2026-08-14 at
  <https://lacuna-five.vercel.app>, on the Vercel free tier, so no paid action
  occurred. It answers every gold question from a recorded snapshot: replies a
  live HydraDB node produced at export time, stored byte for byte, decoded in
  production by the same client code the live server uses. The site states this
  about itself on its own pages. Verified from outside the same day, every
  route and one answer of each kind, transcripts in
  [artifacts/verification/2026-08-14f/](artifacts/verification/2026-08-14f/README.md);
  the design record is D-065 in [DECISIONS.md](DECISIONS.md).
- **Why this shape:** the complication this item named, that HydraDB itself has
  to run somewhere, is real and unresolved. The replay avoids it rather than
  solving it: no node runs behind the URL, no writes happen there, and no token
  is present there. A hosted live node would also collide with the store wedge
  in item 6, which is why the snapshot is the honest shape a public copy can
  take today.
- **What is still yours:** open the URL in a logged-out browser on the day you
  submit, same as the other links, and paste it into form field 5 per
  [docs/SUBMISSION.md](docs/SUBMISSION.md).

## 6. The local graph store wedges, and the fix is a reset

- **Status:** open
- **Why it needs you:** it decides whether anything here can be left running
  unattended, which is a hosting decision and therefore yours.
- **What happens.** Twice now the HydraDB store has stopped accepting writes and
  answered every write with `internal query execution error` over HTTP. The node
  log carries the real reason both times: a conditional put that the local
  filesystem backend does not implement. The remedy is to stop the node, move
  the store aside and re-ingest, which takes about 90 seconds and loses whatever
  was in it. Full detail, with the exact error and the pinned crate versions, is
  D-058 in [DECISIONS.md](DECISIONS.md).
- **Why this is not just a bug report.** Moving a store aside is a reset. The
  replacement runs on the same backend as the one that wedged, so it should be
  expected to wedge again. Nothing in this repository can fix that, because the
  gap is in the storage backend HydraDB uses, not in the code here.
- **What it means in practice.** Demoing, developing and testing are all fine:
  the reset is cheap and the corpus reloads clean. A long-lived deployment is
  not fine on this backend. The deploy that happened under item 5 is a recorded
  replay with no node behind it, chosen partly to avoid this exact question; if
  a hosted live node is ever wanted, this is the first thing that has to be
  answered.
- **Blocking?** No. Every gate in the repository is green right now.

## 7. AssemblyAI is the one named fallback with no credential

- **Status:** open, and probably should stay that way
- **Why it needs you:** a credential is yours to create, and creating an account
  is not something to do on your behalf.
- **Detail.** `src/voice/stack.ts` marks AssemblyAI `BLOCKED` rather than
  `NOT_STARTED`, because unlike the others it is blocked on something outside
  the repository rather than on unwritten code. No code calls it either way.
- **The honest recommendation is to leave it.** The voice path this project
  would ship is local, for the reason in D-056: the audio is somebody talking
  about their own stored history, and sending it out to get a transcript back is
  the failure the whole design is arranged against. The metered services are
  named so their absence is on the record, not because they are wanted.

## 8. The API keys staged locally, and revoking them afterwards

- **Status:** open
- **Why it needs you:** revoking a key is an account action.
- **Detail.** The ElevenLabs and Groq keys you pasted are in `.env.local`, which
  `.gitignore` covers and which the history scan confirms was never committed.
  No code in this repository reads either one. They are not in any page, log,
  screenshot, or the video.
- **What to do:** revoke both after the hackathon, as you said you would. Keys
  that were pasted into a chat should be treated as exposed regardless of where
  they ended up on disk.

## 9. The design provenance names a vendor you normally keep out of repos

- **Status:** open, needs a one-line decision from you
- **Why it needs you:** it is your standing rule about your own repositories, and
  I am not going to quietly reinterpret it.
- **The tension.** Your rule is zero Claude or Anthropic anywhere in your
  repositories. The hackathon rules require honest sourcing, and
  `design/reference/` holds artifacts that came from Claude Design, so D-057 and
  the source log name where they came from.
- **Why it was written the way it was.** The rule as you have applied it before
  was about authorship: co-authored-by trailers, generated-with footers,
  `.claude/` directories, handoff files. None of that is here, and the author
  field on every commit is your noreply address. What is here is a citation for
  an imported asset, which is the same kind of line as the HydraDB pin in the
  source log.
- **If you disagree,** the fix is small: the artifacts can be removed and the two
  paragraphs cut, at the cost of the design no longer being checkable against
  what shipped. Say which you want.

## 10. A hosted HydraDB API key was described as provided, and never arrived

- **Status:** open, and the recommendation is to close it as not needed
- **Why it needs you:** only you can say whether a hosted account exists.
- **What was asked for.** One of your instructions says a live HydraDB API key
  was provided separately, and names the variables to read it from:
  `HYDRA_DB_API_KEY`, `HYDRADB_API_KEY`, `HYDRADB_DATABASE`. It goes on to
  describe a hosted service at `api.hydradb.com` speaking a REST contract with
  `Authorization: Bearer` and `API-Version: 2` headers, and two SDK packages.
- **What is actually here.** No such key reached this session. `.env.local`
  holds `HYDRA_HTTP_URL`, `HYDRA_NAMESPACE`, `HYDRA_GRAPH`, `HYDRA_CELL`,
  `HYDRA_TOKEN` and two unrelated provider keys, and nothing named
  `HYDRA_DB_API_KEY`. There is no `@hydradb` package installed. Neither the
  REST contract nor either SDK exists in this codebase, and no code path was
  written that would want them.
- **Why that is the right shape anyway.** The captured rules never mention a
  hosted API, an SDK or a key. Line 331 says "Build a project using the HydraDB
  open-source repo" and line 255 asks the submission to explain "How the
  project uses the HydraDB Open Source Repo". Lacuna builds that repo from the
  commit pinned in [docs/SOURCE_LOG.md](docs/SOURCE_LOG.md) and talks to the
  node it runs, which is the thing the rules ask about. Swapping a working
  local integration for a hosted one nobody asked for would trade verified
  evidence for a service call.
- **What to do:** nothing, unless a hosted HydraDB account exists that you want
  in the submission. If it does, say so and it becomes a second transport
  behind the same client rather than a replacement for the one that works.

---

## Resolved

- **Publishing the repository**, 2026-08-13. Kept as item 2 above rather than
  moved down here, because the route it took is worth reading once and moving it
  would renumber every link pointing at items 3 to 5.

---

## Not escalated, decided instead

Recorded here so it is visible that they were considered and not silently
skipped. Full reasoning in [DECISIONS.md](DECISIONS.md).

- **Where to build.** `D:\project\lacuna`, a fresh repository. `D:\` itself is
  your whole drive with ~38 unrelated projects in it, including the
  pre-hackathon `hydrasentry`, so building there would have made eligibility
  impossible to demonstrate.
- **How to run HydraDB.** Docker Desktop, podman and cargo were all absent from
  the machine and WSL had no distro. Rather than escalate an install, Ubuntu
  24.04 was installed into WSL and HydraDB is built from source there following
  the upstream `AGENTS.md` sequence. Reversible with `wsl --unregister`.
- **One conventions file.** Repository conventions live in a single vendor-neutral
  `AGENTS.md`, which is also the filename HydraDB upstream uses.
