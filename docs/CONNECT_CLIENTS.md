# Connect Lacuna

Public web: <https://lacuna-five.vercel.app/explore>

Public remote MCP: <https://lacuna-five.vercel.app/mcp>

The public workspace is a seeded synthetic corpus. Its remote MCP endpoint is
authless and read-only. A live `tools/list` on 2026-08-21 returned seven tools.
ChatGPT has called all seven against HydraDB Cloud; Claude remains a documented,
untested setup path.

## ChatGPT custom MCP app, read-only

Use ChatGPT on the web. OpenAI currently gives Pro users custom MCP read/fetch
access in developer mode; full MCP actions are limited to eligible workspace
plans. Plan controls and UI labels can hide the creation flow.

1. Open **Settings > Apps > Advanced settings** and enable **Developer mode**.
2. Open **Settings > Apps > Create**. On Business or Enterprise/Edu, a workspace
   admin may first need to enable the permission and create or publish the app.
3. Name the app `Lacuna`.
4. Set the remote MCP endpoint to
   `https://lacuna-five.vercel.app/mcp`.
5. Choose no authentication. The public endpoint does not require a key or
   OAuth.
6. Select **Scan tools**, wait for the scan, then select **Create**.
7. Start a new chat and enable Lacuna from the tools/app menu. For the narrowest
   Pro-compatible proof, ask: `Search Lacuna for Bellwether, fetch the matching
   record, and cite what is current versus superseded.`

The Lacuna server advertises seven read-only tools. A ChatGPT plan may expose
only the actions it permits. The accepted production proof called health, ask,
timeline, explain, sentence read, search and fetch; its secret-free summary is
[`artifacts/verification/2026-08-21-v10/chatgpt-public-connector.json`](../artifacts/verification/2026-08-21-v10/chatgpt-public-connector.json).

OpenAI's current setup and plan boundary:
<https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt>

## Claude and Claude Desktop, remote

Anthropic currently supports authless Streamable HTTP custom connectors on
Claude and Claude Desktop for eligible plans.

1. Open **Settings > Connectors**.
2. Select **Add custom connector**.
3. Enter the name `Lacuna` and URL
   `https://lacuna-five.vercel.app/mcp`.
4. Select **Add**. No authentication is required for the public workspace.
5. In a chat, open **Search and tools**, enable Lacuna, and ask:
   `Use Lacuna to explain why the runbook owner for billing-gate is unresolved.
   Include both sources.`

For Team or Enterprise, an Owner or Primary Owner may need to add the
organization connector first. Remote connectors for Claude Desktop are added
through Settings, not `claude_desktop_config.json`.

Anthropic's current remote connector instructions:
<https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp>

## Claude Code

Add the public Streamable HTTP endpoint:

```bash
claude mcp add --transport http lacuna https://lacuna-five.vercel.app/mcp
claude mcp get lacuna
claude mcp list
```

Start Claude Code, run `/mcp` to inspect the connection, then ask the same
evidence question. To share the entry through a project `.mcp.json`, add
`--scope project` to the first command. The default scope is local to the
current project.

Anthropic's Claude Code MCP reference:
<https://docs.anthropic.com/en/docs/claude-code/mcp>

## Cursor, and Grok Bot

Grok Bot is a Cursor build, so both read the same file and neither needs a key.
This repository ships it at `.cursor/mcp.json`, which means opening this folder
is the whole setup:

```json
{
  "mcpServers": {
    "lacuna": {
      "type": "http",
      "url": "https://lacuna-five.vercel.app/mcp"
    }
  }
}
```

To use Lacuna from any other folder, copy that file into that project's
`.cursor/mcp.json`, or add the same entry through Customize > MCPs in the app.
Restart the app, then confirm the seven tools are listed before relying on them.

What this gives the assistant is the public read-only catalog below and nothing
else: it can ask what a value is, ask how that answer was reached, walk the
history of a pair, and search the corpus. It cannot write, reset, delete or
schedule anything, because no such tool is published. An agent that reports
"updated Lacuna" is reporting something it could not have done.

Two habits make the answers worth trusting. Prefer `lacuna_explain` over
`lacuna_ask` when the answer will be repeated to someone else, because it
returns the resolution and the evidence rather than the value alone. And treat
an abstention as a result: Lacuna abstains when a pair is contested or was taken
back, and the reason it gives is the useful part.

## Any Streamable HTTP MCP client

The public endpoint is `POST /mcp`. Send JSON-RPC and accept both JSON and SSE:

```bash
curl -s https://lacuna-five.vercel.app/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The expected public catalog is:

1. `lacuna_ask`
2. `lacuna_explain`
3. `lacuna_timeline`
4. `lacuna_read_question`
5. `search`
6. `fetch`
7. `lacuna_health`

The public catalog contains no write, reset, delete, schedule or agent-run tool.
The candidate private `lacuna_remember` tool is outside the public claim until
production issue/use/revoke/expiry and external-client gates pass. Candidate
private capabilities expire after 30 days; any version-1 credential must be
reminted after rollout.

## REST and web

The no-account web route is <https://lacuna-five.vercel.app/explore>. Useful
deep links are `/explore/ask`, `/explore/memory`, `/explore/graph`,
`/explore/timeline`, `/explore/agents`, `/explore/work`, `/explore/hydra`,
`/explore/cli` and `/explore/mcp`.

Ask in a sentence:

```bash
curl -s https://lacuna-five.vercel.app/api/explore/query \
  -H 'Content-Type: application/json' \
  -d '{"question":"who is the runbook owner for billing-gate?"}'
```

Ask with the exact subject/predicate contract:

```bash
curl -s https://lacuna-five.vercel.app/api/explore/ask \
  -H 'Content-Type: application/json' \
  -d '{"subject":"Bellwether","predicate":"beta_partner"}'
```

Add `"via":"beta_partner"` for the supported single-hop form. Terms are
bounded to 200 characters; sentence questions are bounded to 300.

Read a bounded graph page:

```bash
curl -s 'https://lacuna-five.vercel.app/api/explore/graph?mode=overview&limit=140'
curl -s 'https://lacuna-five.vercel.app/api/explore/graph?mode=proof&limit=140'
```

Use the opaque `page.nextCursor` as the next `cursor` query parameter. Do not
construct or edit it. The signed-in `/api/ask` and `/api/workspace/*` routes use
session and CSRF boundaries; integrations should not bypass those with a
caller-supplied workspace id.

## CLI

Install from the repository:

```bash
npm ci
npm link
lacuna --help
```

For a self-hosted HydraDB node, copy `.env.example` to `.env.local`, fill its
five HydraDB fields, ingest the corpus, then run `lacuna doctor`.

For HydraDB Cloud, create a gitignored `.env.cloud` containing server-only
values:

```dotenv
LACUNA_PROFILE=cloud
HYDRA_CLOUD_URL=https://api.hydradb.com
HYDRA_CLOUD_TOKEN=
HYDRA_DATABASE=
HYDRA_COLLECTION=
```

Never commit a token. `lacuna profile` says which store was selected without
printing its address or credential. The nine CLI commands are documented in
[CLI.md](CLI.md).

## Local stdio MCP

From a configured checkout:

```bash
npm run mcp -- --stdio
```

Generic client configuration:

```json
{
  "mcpServers": {
    "lacuna": {
      "command": "npm",
      "args": ["run", "mcp", "--", "--stdio"],
      "cwd": "/absolute/path/to/lacuna"
    }
  }
}
```

The MCP process reserves stdout for JSON-RPC. Diagnostics go to stderr.

## SDK boundary

There is no packaged Lacuna TypeScript, Python or REST SDK and no published
`@lacuna/sdk`. The repository depends on `@modelcontextprotocol/sdk` to
implement MCP; that dependency is not a Lacuna client library. Use the live
REST contract, the CLI, or MCP. Any TypeScript SDK sample in a historical design
artifact is a design contract, not installable code.
