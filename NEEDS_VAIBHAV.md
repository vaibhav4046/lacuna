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

- **Status:** open, and optional
- **Why it needs you:** deploying to a hosting account is publishing, and any
  paid tier is a paid action.
- **Detail:** the form asks for a "deployed project link, if available", so it is
  explicitly optional. A local-run product with clean instructions satisfies
  every stated repository requirement. If you want a public deploy, the honest
  complication is that HydraDB itself has to run somewhere, and a free tier that
  will host a Rust graph database with object storage is not a given. Decide
  later, with real information, not now.

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
