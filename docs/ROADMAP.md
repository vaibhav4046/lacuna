# Lacuna public roadmap

This roadmap records useful, evidence-preserving work. It is not a promise of
shipping dates and it does not expand the current product claims.

## Now: strengthen the verified core

1. **Reproduce and remove the worker-thread parser isolation flake.** Keep the
   full unit run deterministic across supported environments.
2. **Shorten first-run setup.** Preserve the snapshot path while making the
   self-hosted HydraDB path easier to diagnose.
3. **Complete external private-MCP verification.** Issue, use, revoke and expire
   a version-2 capability from an external client before calling private
   `remember` verified.
4. **Improve failure fixtures.** Add small, readable examples for superseded,
   contradicted, retracted and never-stated outcomes.
5. **Keep production evidence current.** Update the release-status and evidence
   index whenever the deployed boundary changes.

## Next: expand without weakening abstention

1. Add new extraction frames only with high-precision fixtures and negative
   tests that prove nearby plans, questions and instructions stay non-authoritative.
2. Run a complete official LongMemEval answer and judge path when the adapter,
   per-question graph isolation and paid judge execution are all ready. Until
   then, claim only ingestion coverage.
3. Publish a stable package or release only after its install, versioning and
   compatibility contract are documented and reproduced from a clean checkout.
4. Add connector workflows one at a time with bounded imports, review steps,
   cancellation, redaction and explicit readiness states.

## Later: ecosystem work

- broader client compatibility with named external verification;
- richer evidence visualisation and diffing;
- additional datasets and benchmark adapters with ground-truth isolation;
- contributor-owned examples and integrations that preserve the same answer contract.

## Non-goals

- treating arbitrary English as a fact without a bounded parser contract;
- replacing explicit abstention with a plausible model guess;
- unaudited autonomous writes to authoritative memory;
- claiming an official score from the generated 64-question repository check;
- adding integrations only for logo count.

## Contribution map

| Area | Good first contribution | Deeper contribution |
| --- | --- | --- |
| Documentation | Fix a broken setup step or add a redacted screenshot | Rewrite a complete client journey and verify it from a clean machine |
| Extraction | Add a negative fixture for a false claim | Add a new frame with positive, negative and adversarial coverage |
| MCP/CLI | Improve error copy or an example | Add a contract feature with web/CLI/MCP parity tests |
| Web | Accessibility, reduced-motion or responsive fix | Evidence graph interaction with route and browser audits |
| Benchmarks | Improve artifact explanation | Add an isolated official-dataset adapter and reproducible judge path |

Open a scoped issue before beginning architectural work.
