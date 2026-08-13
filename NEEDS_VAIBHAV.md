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

- **Status:** open. The repository now exists. The push does not.
- **Where it stands:** on your approval, `gh repo create` ran on 2026-08-13 and
  succeeded. <https://github.com/vaibhav4046/lacuna> is public, `origin` is wired
  for fetch and push, and the repository is empty. The push that follows it was
  rejected:

  ```
  remote: error: GH007: Your push would publish a private email address.
  remote: You can make your email public or disable this protection by visiting:
  remote: https://github.com/settings/emails
   ! [remote rejected] main -> main (push declined due to email privacy restrictions)
  ```

  That is the failure this item predicted below before anything was attempted, so
  the diagnosis is already written and confirmed rather than guessed.
- **Why it needs you:** the fix is one toggle at
  <https://github.com/settings/emails>, and it is on your account, not in this
  repository. Two reasons it stays yours. The `gh` token here holds `gist`,
  `read:org`, `repo` and `workflow`; `gh api user/emails` returns
  `This API operation needs the "user" scope`, and granting that scope is a
  browser login approval. More to the point, clearing `GH007` publishes
  `lalwanivaibhav079@gmail.com` in the author field of all 41 commits, in public,
  permanently, on a repository that will be cloned. That is a privacy decision
  about your own address and not an implementation detail to be decided for you.
- **What to do:** turn off "Keep my email addresses private", or the "Block
  command line pushes that expose my email" toggle under it, then:

  ```bash
  git push -u origin main
  ```

  Run it from `D:\project\lacuna`. Nothing else is pending. Turning the setting
  back on afterwards does not retract the published address, so treat it as
  one-way.
- **The other exit stays closed.** Rewriting the author email across 41 commits
  would also clear `GH007` and it is not being done. The eligibility argument here
  rests on a history nobody touched, [STATE.md](STATE.md) and the
  [README](README.md) both say so in as many words, and rewriting every hash the
  night before a submission is exactly the shape of the thing a judge is entitled
  to be suspicious of. A cosmetic push error is not worth spending that.
- **Publication safety, cleared on 2026-08-13 before the attempt.** Nothing below
  is a reason to hesitate, and each was run rather than assumed:
  - 257 blobs across all 38 commits scanned for tokens, private keys and AWS
    keys. Zero hits. The working tree scan is separate and also zero across 135
    files.
  - `.env.example` is the only environment file tracked, and `.gitignore` covers
    `.env`, `.env.local`, `*.pem`, `*.key` and the local database directories.
  - `LICENSE` is Apache-2.0 and committed, which is one of the seven
    disqualification triggers closed.
  - First commit is `2026-08-12 21:22:04 +0100`, inside the eligibility window,
    which closes a second trigger. Nothing in history predates kickoff and no
    history was rewritten.
  - Zero Claude or Anthropic attribution anywhere in author fields or messages.
  - 186 relative links across 24 markdown files resolve. 610 tests pass.
- **Note on commit email, now confirmed by the push rather than predicted:** every
  commit already made carries the personal Gmail address that `git config
  user.email` returns on this machine. Switching the repo-local email to the
  `users.noreply.github.com` address does not clear `GH007`, because that only
  changes commits made afterwards and `GH007` is raised against the commits inside
  the push. Worth stating explicitly because it is the obvious first thing to try
  and it cannot work.
- **Deadline pressure:** the repo is public but empty, which is worse than not
  existing if a judge finds it. It has to hold the code before submission. It does
  not have to hold it today.

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
  rather than from memory, plus a pre-submit checklist. Nine are ready to paste.
  The repository link is now known, <https://github.com/vaibhav4046/lacuna>, but
  do not paste it until item 2 has actually pushed, because right now that URL
  resolves to an empty repository and a judge following it early sees nothing.
  The video link (item 3) is the one genuine blank.
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
