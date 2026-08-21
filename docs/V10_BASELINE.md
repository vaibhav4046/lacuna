# V10 baseline

Recorded 2026-08-21 before the V10 restoration is accepted.

## Repository checkpoint

| Item | Recorded value |
| --- | --- |
| Branch | `main` |
| Starting HEAD | `209de17589ae71873aee5ea4e0e5fb5fede23a4f` |
| Starting `origin/main` | `63576dc85b475833d5ca56006977056fcf688b2b` |
| Ahead of origin | 1 commit |
| Clean checkpoint | `checkpoint/pre-v10-20260821-021653` |
| Dirty checkpoint | `checkpoint/pre-v10-20260821-021653-dirty` at `902bbc5` |
| Production URL | <https://lacuna-five.vercel.app> |
| Vercel project | `lacuna` |

The working tree was intentionally not cleaned. It contained the completed V8
product and film work, privacy-safe handling for the clean voice-clone source,
and the in-progress approved-design restoration. Both checkpoint refs were made
without switching branches or removing local files.

## Media at checkpoint

- The corrected local judges master is
  `video/hyperframes/renders/lacuna-v8-judges-master-vaibhav.mp4`.
- Recorded master facts are 179.0 seconds, 1920x1080, 30 fps, 126,468,170
  bytes, SHA-256
  `C941FDA5F1D40856FBCB1C2D18816C6E4C917924740B78B80351D940E5BDFD28`.
- The clean Vaibhav Lalwani Professional narration source remains local. Its
  recorded SHA-256 is
  `FF7472F1C136C7C4FAE8C72F09F90D6D74EA503366D6CDD3F2F398F6604A263A`.
- V10 treats that film as a technically verified historical candidate, not as
  the approved new film language.

## Proven baseline before V10

The latest exact completed local gate before this checkpoint reported:

- 79 unit-test files and 1,345 tests passed.
- Root and web typechecks passed.
- The production web build passed.
- Copy lint scanned 57 files with 0 findings.
- The claims ledger passed 16 of 16.
- The corrected V8 master passed full decode, media metadata, audio-tail,
  caption continuity and hash verification.

These are prior-run facts, not substitutes for the V10 rerun. The active V10
baseline rerun records its exact command results here after completion.

## Current production truth

`artifacts/release/current.json` still describes an older accepted deployment
and an older 173.5-second film. It must not be used as the V10 release manifest
until regenerated from the frozen V10 candidate. `STATE.md` already labels the
stable URL as the last accepted V8 deployment rather than the local candidate.

## V10 baseline gate status

| Gate | Status | Evidence |
| --- | --- | --- |
| Working tree preserved | PASS | clean and dirty checkpoint refs above |
| Approved oracle located | PASS | `design/reference/Lacuna Product.dc.html` |
| Approved React port located | PASS | commit `132d734` |
| Memory Gravity Field located | PASS | commit `e6bca46`, current `web/src/canvas/engine.ts` |
| Rejected replacement identified | PASS | current `Journey.tsx`, rejected hero aperture and header pill |
| Root typecheck | RUNNING | V10 rerun |
| Web typecheck and build | RUNNING | V10 rerun |
| Unit and focused subsystem tests | RUNNING | V10 rerun |
| Contract/live-node gates | PENDING ENVIRONMENT PROBE | V10 rerun |
| Browser and visual comparison | RUNNING | restored landing preview |
| Production SHA | NOT FROZEN | no V10 deploy yet |
