# X launch thread

## Post 1

AI agents do not only fail because they forget.

They fail when they confidently remember something that is no longer true.

I built Lacuna: temporal, provenance-first agent memory on HydraDB.

Demo: https://lacuna-five.vercel.app/explore
Repo: https://github.com/vaibhav4046/lacuna

## Post 2

Lacuna distinguishes four cases ordinary retrieval often flattens together:

- current
- superseded or retracted
- contradicted
- never stated

Every answer carries evidence. Unsupported questions return a typed abstention.

## Post 3

The failure test:

`who is the runbook owner for billing-gate?`

Two sources disagree. Lacuna shows both quotations and refuses to silently pick a
winner.

That behaviour matters more than a polished happy-path chat response.

## Post 4

Current surfaces:

- web workspace
- 9-command CLI
- 7-tool public read-only MCP
- HydraDB Cloud persistence
- separate self-hosted graph/Cypher adapter
- reproducible snapshot with no token

## Post 5

Honest boundary: the extractor reads bounded sentence frames, not arbitrary
English. The generated 64-question repository check is not official LongMemEval.
No official LongMemEval score is claimed.

Break it and send the failure case. If it earns the star, star it.
