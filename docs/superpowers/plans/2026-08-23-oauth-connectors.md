# OAuth Connector Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, read-only OAuth connection and reviewed import workflows without changing Lacuna's Google identity sign-in scopes.

**Architecture:** Provider-specific authorization, token refresh, source listing, and document extraction live behind a server-owned adapter. The browser receives only connection state and reviewed import receipts; provider tokens remain encrypted server-side. Existing `ConnectorRunner` continues to normalize, ingest, and record observations.

**Tech Stack:** TypeScript, Node `fetch`, signed session/CSRF boundary, HydraDB connector state, Vercel encrypted environment variables, Vitest.

**Spec:** `docs/V10_RELEASE_STATUS.md`

## Global Constraints

- Keep Google identity sign-in identity-only; Gmail uses a distinct consent flow.
- Require session, CSRF, exact origin and workspace ownership for every mutation.
- Use least-privilege read scopes; never return a provider token to the browser.
- Make unavailable providers explicit until their client ID, secret, callback URL and admin consent are verified.
- Keep reviewed imports explicit: list first, confirm import second, exact receipt third.

---

### Task 1: Provider registry and availability contract

**Files:**
- Modify: `src/connectors/types.ts`, `src/connectors/catalog.ts`, `web/src/api/connectors.ts`, `web/src/design/connectors.ts`
- Test: `tests/unit/connectors-catalog.test.ts`, `tests/unit/web-connectors-client.test.ts`

**Interfaces:**
- Produces `OAuthConnectorId = 'gmail' | 'slack' | 'notion' | 'linear' | 'jira' | 'confluence'`.
- Produces `catalogue({ oauth: { gmail: boolean, slack: boolean, notion: boolean, linear: boolean, jira: boolean, confluence: boolean } })` entries.

- [ ] **Step 1: Write the failing test**

```ts
it('exposes Gmail only when dedicated OAuth configuration is complete', () => {
  expect(catalogue({ oauth: { gmail: false } }).find((entry) => entry.id === 'gmail'))
    .toMatchObject({ availability: 'unavailable', reason: 'oauth_not_configured' });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/connectors-catalog.test.ts`

Expected: fails because `gmail` is not a connector ID.

- [ ] **Step 3: Implement the minimum registry**

```ts
export type OAuthConnectorId = 'gmail' | 'slack' | 'notion' | 'linear' | 'jira' | 'confluence';
export type ConnectorId = ExistingConnectorId | OAuthConnectorId;
```

Use `oauth_not_configured` as the unavailable reason. Keep `Database source` planned until it has a connection-string and network-policy design.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx vitest run tests/unit/connectors-catalog.test.ts tests/unit/web-connectors-client.test.ts`

Run: `git add src/connectors/types.ts src/connectors/catalog.ts web/src/api/connectors.ts web/src/design/connectors.ts tests/unit/connectors-catalog.test.ts tests/unit/web-connectors-client.test.ts; git commit -m "feat: register OAuth connector availability"`

### Task 2: Encrypted connection state and OAuth proof

**Files:**
- Create: `src/connectors/oauth.ts`, `src/connectors/oauth-store.ts`
- Modify: `src/api/router.ts`, `src/server/server.ts`
- Test: `tests/unit/connectors-oauth.test.ts`, `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Produces `beginOAuthConnection(workspace, provider, returnPath): { authorizationUrl: string }`.
- Produces `finishOAuthConnection(provider, callback): Promise<'connected' | 'refused'>`.
- Produces `OAuthConnectionState` with `{ connected: boolean; connectedAt: string | null }` only.

- [ ] **Step 1: Write the failing callback-binding test**

```ts
it('refuses a callback when signed state belongs to another session', async () => {
  const response = await callbackFor(secondSession, validCallbackFor(firstSession));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: 'oauth_state_invalid' });
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/connectors-oauth.test.ts`

Expected: fails because the OAuth module and callback route do not exist.

- [ ] **Step 3: Implement the minimum server-only boundary**

```ts
interface OAuthProviderConfig { clientId: string; clientSecret: string; authorizeUrl: string; tokenUrl: string; scopes: readonly string[]; }
interface OAuthConnectionState { connected: boolean; connectedAt: string | null; }
```

Bind signed, expiring state to session, workspace, provider, PKCE verifier and canonical return route. Encrypt refresh tokens with `LACUNA_OAUTH_TOKEN_KEY` before persistence. Return only `OAuthConnectionState`.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx vitest run tests/unit/connectors-oauth.test.ts tests/unit/connectors-api.test.ts`

Run: `git add src/connectors/oauth.ts src/connectors/oauth-store.ts src/api/router.ts src/server/server.ts tests/unit/connectors-oauth.test.ts tests/unit/connectors-api.test.ts; git commit -m "feat: add secure OAuth connector sessions"`

### Task 3: Bounded provider adapters

**Files:**
- Create: `src/connectors/providers/google-gmail.ts`, `src/connectors/providers/slack.ts`, `src/connectors/providers/notion.ts`, `src/connectors/providers/linear.ts`, `src/connectors/providers/atlassian.ts`
- Modify: `src/api/router.ts`, `src/connectors/run.ts`
- Test: `tests/unit/connectors-provider-imports.test.ts`, `tests/unit/connectors-api.test.ts`

**Interfaces:**
- Consumes a server-only `ProviderAccessToken` and bounded source selector.
- Produces `readonly ConnectorDocumentInput[]` with provider-specific source URLs and no token-derived metadata.

- [ ] **Step 1: Write the failing bounded Slack import test**

```ts
it('limits a Slack reviewed import to the selected channel and 100 messages', async () => {
  const documents = await slack.review({ channelId: 'C123', limit: 100 });
  expect(documents).toHaveLength(100);
  expect(documents.every((item) => item.provenance.connectorId === 'slack')).toBe(true);
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/connectors-provider-imports.test.ts`

Expected: fails because provider adapters do not exist.

- [ ] **Step 3: Implement fixed, read-only bounds**

Implement Gmail message, Slack channel/thread, Notion page/data-source, Linear issue, Jira issue and Confluence page adapters. Validate response shape, cap document and character counts, reject unbounded pagination, redact IDs from errors, and pass normalized documents to `ConnectorRunner`.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx vitest run tests/unit/connectors-provider-imports.test.ts tests/unit/connectors-api.test.ts`

Run: `git add src/connectors/providers src/api/router.ts src/connectors/run.ts tests/unit/connectors-provider-imports.test.ts tests/unit/connectors-api.test.ts; git commit -m "feat: add bounded OAuth connector imports"`

### Task 4: Private controls and production verification

**Files:**
- Modify: `web/src/app/routes/connectors.tsx`, `web/src/api/connectors.ts`, `web/src/styles.css`, `docs/V10_RELEASE_STATUS.md`
- Test: `tests/unit/web-connectors.test.ts`, `tests/unit/web-connectors-client.test.ts`

**Interfaces:**
- Consumes connection state plus reviewed source selectors.
- Produces `CONNECT`, `REVIEW`, `CONFIRM IMPORT`, and `DISCONNECT` controls without secrets.

- [ ] **Step 1: Write the failing Gmail connection-control test**

```ts
it('renders Gmail connect only when server says Gmail is available', () => {
  render(<PrivateConnectors />);
  expect(screen.getByRole('button', { name: 'CONNECT GMAIL' })).toBeEnabled();
});
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run tests/unit/web-connectors.test.ts`

Expected: fails because the OAuth connector card is absent.

- [ ] **Step 3: Implement and verify each provider**

Render cards from the server catalogue, open OAuth after an explicit click, require explicit import confirmation, and require disconnect confirmation. Set each client ID/secret only after its provider console confirms the production callback URL. For each provider, verify state mismatch refusal, token non-disclosure, revoke/disconnect, and exact reviewed-import receipt.

- [ ] **Step 4: Run GREEN and commit**

Run: `npm run typecheck; npm run build; npx vitest run tests/unit/web-connectors.test.ts tests/unit/web-connectors-client.test.ts tests/unit/connectors-api.test.ts`

Run: `git add web/src/app/routes/connectors.tsx web/src/api/connectors.ts web/src/styles.css docs/V10_RELEASE_STATUS.md tests/unit/web-connectors.test.ts tests/unit/web-connectors-client.test.ts; git commit -m "feat: add reviewed OAuth connector controls"`
