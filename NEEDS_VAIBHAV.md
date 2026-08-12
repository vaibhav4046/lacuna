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
- **Note on commit email:** local git identity is
  `lalwanivaibhav079@gmail.com`. If GitHub email privacy is on, a push is
  rejected with `GH007`. Fix is to set the repo-local email to the GitHub
  `users.noreply.github.com` address before the first push.
- **Deadline pressure:** the repo must be public and reachable without a
  permission request before submission. It does not have to be public today.

## 3. Demo video

- **Status:** open
- **Why it needs you:** it is your face and voice, and uploading it publishes
  content.
- **What you get from me:** a shot-by-shot script cut to under 3 minutes, the
  exact screens in order, and the seeded demo state so every take shows the same
  data. Recording and upload are yours.
- **Hard constraint from the rules:** 3 minutes or less, and "anything past the
  3-minute mark may not be reviewed". Judges must be able to watch it without
  requesting access, so unlisted YouTube is fine, Drive-with-permissions is not.

## 4. Submission form

- **Status:** open
- **Why it needs you:** final submission is irreversible and is your
  confirmation to make.
- **What you get from me:** every field pre-drafted (project name, description,
  problem, what was built, how it uses the HydraDB OS repo, tech stack, team
  members and contributions, repo link, video link) so it is a paste-and-check.
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
