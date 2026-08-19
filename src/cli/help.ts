import type { Command } from './args.js';
import { TIMEOUT_ENV } from './args.js';

/**
 * The help text, in one file, written out rather than generated.
 *
 * A generated usage line stays correct and reads like a type signature. These
 * are the strings a person sees when they are stuck, so they say what each
 * command is for and what it does with an abstention, which no parser table
 * knows.
 */

const GENERAL = `lacuna - ask the sessions what was decided

usage
  lacuna <command> [arguments] [flags]

commands
  doctor                              check the node, the config and this machine
  status                              show what this CLI is pointed at and what is in it
  ask <subject> <predicate>           answer the question, with the evidence
  explain <subject> <predicate>       the same answer, plus how it was resolved
  timeline <subject> <predicate>      every claim on the pair, oldest first
  bench                               print the committed benchmark table

flags
  --via <relation>                    resolve through a relation, for ask, explain, timeline
  --json                              machine readable output on stdout
  --timeout <ms>                      per query timeout, positive whole milliseconds
  -h, --help                          this text, or help for a command
  -V, --version                       print the version

configuration
  Flags beat the environment, the environment beats the defaults. A .env.local at
  the repository root is read when it exists, and never overwrites a variable that
  is already set.

  HYDRA_HTTP_URL, HYDRA_NAMESPACE, HYDRA_GRAPH, HYDRA_CELL, HYDRA_TOKEN
  ${TIMEOUT_ENV}

exit codes
  0  success, including an abstention
  2  usage error
  3  configuration or auth error
  4  HydraDB unavailable
  5  internal error

An abstention is not a failure. "No answer" with a reason code exits 0.`;

const PER_COMMAND: Record<Command, string> = {
  profile: `lacuna profile - which context store this machine reads

usage
  lacuna profile [--json]

Prints the active profile, how it was decided, and which profiles this machine
could reach if asked. It does not query the store, so it still answers when the
store is down.

  cloud   HydraDB Cloud, configured in .env.cloud. What production reads.
  node    the self-hosted node, configured in .env.local.

LACUNA_PROFILE=cloud or LACUNA_PROFILE=node decides. Without it, a configured
cloud wins, because a machine given a cloud database has been told which store
it belongs to.

Names of a database and a collection are printed. An address and a token are
never printed.`,
  doctor: `lacuna doctor - check that an answer is possible

usage
  lacuna doctor [--json] [--timeout <ms>]

Runs six checks and prints one line each: the Node version, the configuration,
whether a token is present, whether the node answers, a real query with its
latency and read epoch, and whether artifacts/ is writable.

The token is reported as set or missing. Its value is never printed.

Exits with the code of the first failing check, so an unreachable node exits 4
and a bad token exits 3.`,

  status: `lacuna status - what this CLI is pointed at

usage
  lacuna status [--json] [--timeout <ms>]

Prints the node URL, namespace, graph and cell, one count per node label, and
the read epoch those counts were answered at.`,

  ask: `lacuna ask - answer a question from the sessions

usage
  lacuna ask <subject> <predicate> [--via <relation>] [--json] [--timeout <ms>]

example
  lacuna ask Bellwether beta_partner
  lacuna ask Bellwether launch_date --via beta_partner

Prints the answer, the quoted evidence with the session it came from, and how
many queries it took. If the sessions never settled the question it prints no
answer and the reason, and exits 0.`,

  explain: `lacuna explain - the answer and how it was reached

usage
  lacuna explain <subject> <predicate> [--via <relation>] [--json] [--timeout <ms>]

Everything ask prints, plus the ordered resolution steps and the statements that
were sent to HydraDB with their row counts, latencies and read epochs.`,

  timeline: `lacuna timeline - every claim on a subject and predicate

usage
  lacuna timeline <subject> <predicate> [--via <relation>] [--json] [--timeout <ms>]

Prints the full chain oldest first: each claim's valid-from time, the time it was
recorded, its value, and whether it was superseded and by which claim.`,

  bench: `lacuna bench - print the committed benchmark

usage
  lacuna bench [--json]

Reads artifacts/bench/results.json and prints the best configuration of each
system family. This does not run the benchmark. The numbers are the ones in the
committed file.`,
};

export function helpText(command: Command | null): string {
  return command === null ? GENERAL : PER_COMMAND[command];
}
