# Contributing to Lacuna

Lacuna is an evidence-first memory system. Contributions are welcome, but a
change is not complete merely because the happy path looks convincing. It must
preserve provenance, temporal standing, explicit conflict handling and safe
abstention.

## Before opening a pull request

1. Search existing issues and pull requests.
2. Open or claim a scoped issue for non-trivial work.
3. State the user-visible failure or missing capability.
4. Agree on the smallest testable change.

Small documentation corrections can go directly to a pull request.

## Good contribution areas

- extraction fixtures and high-precision sentence frames;
- temporal, contradiction and abstention regression tests;
- CLI and MCP usability;
- connector import boundaries and failure reporting;
- accessibility, responsive layout and reduced motion;
- reproducible benchmark adapters;
- documentation that shortens the path from clone to verified result.

See [docs/ROADMAP.md](docs/ROADMAP.md) for current priorities.

## Local setup

Requirements: Node.js 20.11 or newer.

```bash
git clone https://github.com/vaibhav4046/lacuna.git
cd lacuna
npm ci
```

The unit suite and typecheck do not require a database:

```bash
npm test
npm run typecheck
```

Build the web application:

```bash
npm run build
```

Run the checked-in snapshot without a HydraDB token:

```bash
npm run serve:snapshot
```

Open <http://127.0.0.1:3015>.

The full self-hosted path is documented in [docs/INGEST.md](docs/INGEST.md).
Never commit `.env.local`, access tokens, private MCP capabilities or user data.

## Test-first expectations

For a behaviour change:

1. Add the smallest failing test that reproduces the missing behaviour.
2. Confirm that it fails for the intended reason.
3. Implement the minimum change.
4. Run the focused test, then the relevant wider suite.
5. Record the exact commands and results in the pull request.

A bug fix without a regression test needs a clear explanation of why an
automated test is impossible.

## Claim discipline

Do not claim complete readiness, perfect reliability, an official benchmark
score, universal client support or complete security without an exact,
reproducible evidence path.

For every new metric or external integration claim, include:

- the command or probe that produced it;
- the dated artifact or test output;
- the dataset and denominator;
- exclusions and known limitations;
- whether the evidence is local, recorded, preview or current production.

The generated 64-question evaluation is not official LongMemEval. Preserve that
boundary everywhere.

## Pull-request shape

Keep pull requests reviewable. A strong pull request contains:

- one clear user or maintainer problem;
- a focused diff;
- tests or verification evidence;
- screenshots for visible changes;
- documentation updates when public behaviour changes;
- no unrelated refactor.

Use the repository pull-request template and respond to review comments with
technical evidence rather than performative agreement.

## AI-assisted contributions

AI-assisted work is allowed. The contributor remains responsible for every line,
every dependency, every claim and every test result. Do not submit generated
code that you have not read or cannot explain.

## Security reports

Do not open a public issue for a vulnerability that exposes credentials, private
workspace data, authentication bypasses or a working exploit. Follow
[SECURITY.md](SECURITY.md).

## Licence

By contributing, you agree that your contribution is licensed under the
repository's Apache-2.0 licence.
