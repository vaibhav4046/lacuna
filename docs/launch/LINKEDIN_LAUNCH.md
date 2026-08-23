# LinkedIn launch copy

## Main post

AI agents do not only fail because they forget.

They fail when an old decision is retrieved as if it were still true, when two
sources disagree and the system silently chooses one, or when missing evidence
becomes a confident answer.

I built **Lacuna** for that failure.

Lacuna is temporal, provenance-first memory for agents, built on HydraDB. It
keeps each claim tied to the sentence it came from, preserves corrections,
exposes conflicts and abstains when the history cannot support an answer.

The clearest way to test it is not a perfect happy path:

- ask for a value that was corrected;
- ask about two sources that conflict;
- ask for a statement that was withdrawn;
- ask for a fact nobody ever provided.

The public workspace returns a different evidence-backed outcome for each.

What is available now:

- live web workspace with Ask, memory, graph and provenance views;
- nine CLI commands over the same read contract;
- seven verified public read-only MCP tools;
- HydraDB Cloud persistence plus a separate self-hosted graph adapter;
- a reproducible snapshot path that needs no database or token.

I have kept the limitations visible too. The extractor reads bounded sentence
frames rather than arbitrary English. The repository's generated 64-question
check is not official LongMemEval, and no official LongMemEval score is claimed.

Try it: https://lacuna-five.vercel.app/explore

Source and evidence: https://github.com/vaibhav4046/lacuna

I want blunt technical feedback: where does the product stop being clear,
credible or useful? If the repository earns it, a star helps other agent builders
find it.

#AIAgents #OpenSource #MCP #HydraDB

## First comment

Start with these four questions:

1. `what does token-forge depend on?`
2. `who is the runbook owner for billing-gate?`
3. `when does Lowbank launch?`
4. `what is the connection pool size for Foxglove?`

They exercise current, contradictory, retracted and never-stated memory.
