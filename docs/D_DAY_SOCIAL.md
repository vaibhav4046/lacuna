# Lacuna D-day social copy

Publish only after the V10 production gates pass and the final video link works
while signed out. Replace every bracketed field. Do not add winner language
before judging.

## LinkedIn

Last night turned into an all-nighter.

Today I am submitting **Lacuna** to Hack Hydra, Track 03: Memory and Context
Retrieval.

Agents do not only fail because they forget. They fail when an old decision is
retrieved as if it were still true, when a proposal is mistaken for a fact, or
when missing evidence becomes a confident answer.

Lacuna is temporal, provenance-first memory built on HydraDB. Every answer can
show the claim it came from, the original evidence, what it replaced, and why
the system abstained when the history did not support an answer.

What is in the product:

- plain-English Ask with evidence, revision history and explicit abstention
- an interactive memory graph plus a fully readable table and exact proof paths
- bounded Researcher and Reviewer work with persisted Context Packs and handoffs
- nine real CLI commands and a live seven-tool read-only MCP endpoint
- HydraDB Cloud persistence, deterministic record reads, graph context and
  relation inspection

On the labelled generated 64-question evaluation, Lacuna reached 64/64 with
zero unsupported answers using about 18 context tokens. The tuned comparison
reached 63/64 using about 1,843. The repository keeps the slower Lacuna latency
visible too, because a credible memory system should expose its tradeoffs. This
is not official LongMemEval; no LongMemEval score has been produced.

The hardest part was not adding another retrieval layer. It was building a
system that can say: this is current, this was replaced, these sources conflict,
or nobody ever stated that.

Three-minute pitch and live demo: [VIDEO URL]

Try Lacuna: [LIVE URL]

Source and evidence: [GITHUB URL]

Built by Vaibhav Lalwani for #HackHydra #HydraDB #AIEngineering #Agents #MCP

## X

Built Lacuna through an all-nighter for #HackHydra: temporal agent memory on
HydraDB that tracks corrections, keeps evidence, exposes conflicts, and abstains
when nothing supports an answer. Web + 9-command CLI + live 7-tool MCP.
[VIDEO URL]

## Optional first comment

The demo uses a seeded synthetic corpus so every correction, conflict and gap is
reproducible. Named client integrations and provider-backed voice stay outside
the claim until their own production proof passes.
