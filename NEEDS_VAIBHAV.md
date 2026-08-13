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

## 2. Create the public GitHub repository and push

- **Status:** open
- **Why it needs you:** creating a public repository publishes code under your
  name. That is an outward-facing action and it is yours to approve.
- **What to do:** say the word and it gets created and pushed. Suggested:
  `github.com/vaibhav4046/lacuna`, public, no description auto-generated.
- **Note on tooling:** `gh` is authenticated as `vaibhav4046` and has the `repo`
  scope, so no credential is missing. Only the approval is.
- **Note on commit email, corrected:** every commit already made carries the
  personal Gmail address that `git config user.email` returns on this machine. If
  "Block command line pushes that expose my email" is on for the GitHub account,
  the push is rejected with `GH007`, and switching the repo-local email to the
  `users.noreply.github.com` address will not clear it, because that only changes
  commits made afterwards and `GH007` is raised against the commits in the push.
  The two ways out are turning that setting off for the account, or rewriting the
  author email across the existing history. The second is off the table under the
  build rules, so this is a setting on your account and it is your call. It has
  not been tested here, because testing it means pushing.
- **Deadline pressure:** the repo must be public and reachable without a
  permission request before submission. It does not have to be public today.

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
  rather than from memory, plus a pre-submit checklist. Eight are ready to paste.
  Two are blanks only you can fill, and both are items on this list: the
  repository link (item 2) and the video link (item 3).
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

Nothing yet.

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
