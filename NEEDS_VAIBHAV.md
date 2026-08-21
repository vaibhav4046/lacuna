# Needs Vaibhav

Only things that genuinely require the owner: credentials, login approval, paid
actions, irreversible actions, publishing, or an organizer-only clarification.
Everything else gets decided and recorded in [DECISIONS.md](DECISIONS.md)
instead of landing here.

Nothing on this list blocks the build. Independent work continues while these
sit open.

Status values: `open`, `done`, `dropped`.

---

## 0. Delete the burned Google client secret

- **Status:** open, and it is the only security item on this list.
- **Why it needs you:** it is a thirty second console action, and it is recorded
  here rather than left to memory because a burned credential that nobody
  deletes is how a leak becomes an incident.
- **What happened:** the first OAuth client secret was displayed in a console
  dialog that was captured during setup, which put it in a transcript. It was
  replaced the same hour. A second secret was created, checked against Google's
  token endpoint before being stored, and the deployment runs on that one.
- **What to do:** open the client `Lacuna web` in project `lacuna-auth-506009`,
  find the secret ending `ERa7`, disable it, confirm sign in still works, then
  delete it. The live secret ends `gCcp`. Nothing running uses the old one.
- **Blocking?** No. Sign in works today.

## 0b. What is ready and waiting on you

- **Day 7 social package**, built from real recorded output, sitting unpublished
  in `social/day7/`. Nothing posts automatically.
- **The demo film**, at
  `video/hyperframes/renders/lacuna-v8-judges-master-vaibhav.mp4`. The
  126,468,170-byte local candidate is over the browser tool's upload cap, so the
  upload is by hand.
- **The submission form**, with everything it asks for collected in
  `docs/SUBMISSION_FINAL.md`.

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
  holds the code. At publication the remote tip was `033c1a8`, `git ls-remote`
  agreed with the local `HEAD`, and the GitHub API reported the repository as
  `private: false`; later commits push to the same place.
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

- **Status:** open for owner approval and publication.
- **Why it needs you:** the final full-length judgement and upload are owner
  actions.
- **What exists:** a metadata-verified film at
  `video/hyperframes/renders/lacuna-v8-judges-master-vaibhav.mp4`, 179.0 seconds,
  1920x1080 at 30 fps, with audio. It uses the verified Vaibhav Lalwani
  Professional clone and burned-in sentence captions. Exact file metadata and
  hashes are in `artifacts/video/final-metadata.json`.
- **What to do:** watch once with sound, once muted for secret and caption
  review, approve it, upload it as unlisted, then open the link while signed
  out. Anything past three minutes may not be reviewed, and the candidate is
  one second under that ceiling.

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

- **Status:** done, and live rather than replayed.
- **What happened:** a copy of the product went public on 2026-08-14 at
  <https://lacuna-five.vercel.app>, on the Vercel free tier, so no paid action
  occurred. It was a recorded replay then. It is not now: it answers live from
  HydraDB Cloud as one serverless function, every reply carries
  `source_state: live` with a measured round trip, and `/api/health` names the
  database and collection it read.
- **What changed since:** HydraDB Cloud removed the reason the replay existed,
  which was that a node had to run somewhere and the local backend wedges
  (item 6). The managed service is not that backend, so the objection does not
  transfer. The self-hosted node is still the profile the benchmarks and the
  contract suite run against, and the two stores answer the same 64 questions
  identically: `artifacts/hydra/cloud-parity.json`.
- **Verified from outside on 2026-08-19:** route audit clean, the six `/judge`
  answers returning in 113 to 325ms, `/api/demo/expansion` walking 21 edges of
  the store's own graph in 2,918ms.
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

- **Status:** dropped, 2026-08-15. No key ever arrived, the captured rules ask
  for the open-source repo rather than a hosted API, and the working local
  integration is the evidence the submission stands on. If a hosted account
  materialises before the deadline, say so and this reopens as a second
  transport, not a replacement.
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
