# Document OCR MCP

> An OAuth 2.1 MCP server that exposes **Google Document AI** to any LLM — OCR, form parsing, and layout analysis returned as clean Markdown, with zero context tokens burned on vision.

[![MCP 2025-06-18](https://img.shields.io/badge/MCP-2025--06--18-black)](https://modelcontextprotocol.io) [![OAuth 2.1](https://img.shields.io/badge/OAuth-2.1-black)](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1) [![ISC](https://img.shields.io/badge/license-ISC-black)](./LICENSE)

---

## Why

LLM vision works for documents, but it's expensive, slow, and clumsy. A multi-step agent re-ingests page images on every turn — a 10-page PDF at 5 steps burns ~55k tokens before you get to the real work. Document AI does OCR right (99%+ accuracy on real-world docs), returns structure, and costs the same or less. This MCP puts that pipeline one prompt away from your agent, over plain OAuth, with no API keys to rotate.

## Use it in your MCP client

Any OAuth-capable MCP client works (Claude Desktop, Perplexity, Claude Code). Point it at the server URL — your client opens a browser, you sign in with the configured IdP, done. No API keys to paste.

Claude Desktop example (`claude_desktop_config.json`):
```jsonc
{
  "mcpServers": {
    "document-ai": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-deployment>.run.app/mcp"],
      "type": "stdio"
    }
  }
}
```

The code grants new users a configurable default of pages on signup (`SIGNUP_FREE_PAGES`, currently `100`). Admins of a deployment load more pages by editing Firestore — see [Admin runbook](#admin-runbook).

Want to run your own deployment? See [Self-hosting](#self-hosting).

## Tools

| Tool | Purpose | Returns |
|---|---|---|
| `ocr_document` | Extract text from a PDF / image | `taskId` — poll with `get_result` |
| `parse_form` | Extract key-value pairs as a Markdown table | `taskId` |
| `parse_layout` | Analyze structure (headings, tables, reading order) | `taskId` |
| `get_result` | Check task status / fetch page(s) | Metadata or Markdown |
| `upload_document` | Stage a document to GCS and get a reusable `gcsUri` | `gcsUri` |
| `get_quota` | Your balance and usage | `pagesAvailable` / used stats |

Processing tools accept `{ content, mimeType }` (inline base64), `{ gcsUri }` (pre-uploaded), or `{ url }` (remote). Processing is async via Cloud Tasks; online mode runs docs ≤15 pages in ~3 s, and falls back to batch for longer ones (up to 2,000 pages). `get_result` returns an `ETA in ms` so agents don't idle wait.

## Architecture

```
 ┌───────────────────┐       OAuth 2.1       ┌────────────────────┐
 │  MCP client       │ ───────────────────── │  GitHub (IdP)       │
 │  (Claude, Perp.)  │                       └────────────────────┘
 └────────┬──────────┘                                  ▲
          │ Bearer                              identity delegation
          ▼                                            │
 ┌────────────────────────────────────────────────────┴─────┐
 │                Cloud Run — document-ai-mcp                │
 │                                                           │
 │  AS (oidc-provider)    RS (/mcp, /me, /me/usage)          │
 │         │                        │                        │
 │         ▼                        ▼                        │
 │  Firestore: users, tasks, oidc_* (tokens/grants/...)      │
 │                                                           │
 │  /worker  ← Cloud Tasks (OIDC)   → Document AI            │
 │  /cleanup ← Cloud Scheduler (OIDC)                        │
 └───────────────────────────────────────────────────────────┘

 GCS: batch/{u}/{uuid}/  → 1d    (batch intermediates)
      uploads/{u}/{uuid}/ → 30d  (staged by upload_document)
      results/{taskId}/   → 30d  (page-N.md + metadata.json)
```

- **Server is its own Authorization Server** (via [`oidc-provider`](https://github.com/panva/node-oidc-provider)). Tokens are opaque, stored in Firestore with TTL. Identity is delegated to GitHub; no passwords, no API keys.
- **Processing is async.** Clients enqueue a task and poll. Online mode for short docs (~3 s), automatic batch fallback for long ones (up to 2,000 pages).
- **Results are paginated and cached.** Each page lands in GCS as its own Markdown file; the agent fetches only the pages it needs.
- **Credits are decremented atomically** when processing completes. Users see remaining balance via `get_quota` or the web dashboard.

## Admin runbook

### Load pages to a user

The server reads credits from Firestore — so admin ops are just Firestore edits. No admin HTTP API, no shared-secret endpoints.

Via Firebase Console (easiest):
1. Open `https://console.firebase.google.com/project/<your-gcp-project>/firestore`
2. Navigate to `users/<userId>` (find by email with the query tool)
3. Edit `credits.pagesAvailable` to whatever value you want

Via gcloud (scriptable):
```bash
gcloud firestore documents update "users/<userId>" \
  --update-mask="credits.pagesAvailable" \
  --data='{"credits":{"pagesAvailable":1000000000}}' \
  --project=<your-gcp-project>
```

Or from Node with the Admin SDK:
```js
const { Firestore } = require("@google-cloud/firestore");
const db = new Firestore({ projectId: "<your-gcp-project>" });
await db.collection("users").doc("<userId>").update({ "credits.pagesAvailable": 1_000_000_000 });
```

### Revoke a user's access

Delete `users/<userId>`. Any active Bearer tokens fail at the next `findAccount` lookup.

### Revoke a specific token

Hit the standard OAuth revocation endpoint:
```bash
curl -X POST https://<your-deployment>/oauth/token/revocation \
  -u "<client_id>:<client_secret>" \
  -d "token=<the_access_token>"
```

Or just delete the doc directly from `oidc_AccessToken` / `oidc_RefreshToken` collections.

## Self-hosting

Requirements:
- GCP project with billing enabled
- Node.js 22+, pnpm
- An OAuth App with your IdP of choice (GitHub by default — Google, Microsoft, etc. work with a small adapter swap; see [Swapping the IdP](#swapping-the-idp))
- `gcloud` logged in locally

### 1. Clone & install

```bash
git clone https://github.com/FrancoReyesDev/document-ai-mcp.git
cd document-ai-mcp
pnpm install
```

### 2. Enable GCP APIs

```bash
gcloud services enable \
  documentai.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com
```

### 3. Create Document AI processors

One each of OCR, Form Parser, Layout Parser. Note each processor's resource name (`projects/{num}/locations/us/processors/{id}`).

### 4. Create GitHub OAuth App

GitHub → Settings → Developer settings → OAuth Apps → New.
- **Homepage URL**: your web dashboard URL
- **Authorization callback URL**: `https://<your-mcp-url>/oauth/interaction/callback/github`
- **Scope**: `user:email`

Save Client ID + Secret.

### 5. Generate secrets

```bash
node -e "
const c = require('node:crypto');
const { privateKey } = c.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
jwk.kid = c.randomUUID(); jwk.alg = 'ES256'; jwk.use = 'sig';
console.log('JWKS=', JSON.stringify({ keys: [jwk] }));
console.log('COOKIE_KEYS=', JSON.stringify([c.randomBytes(32).toString('hex'), c.randomBytes(32).toString('hex')]));
console.log('WEB_CLIENT_SECRET=', c.randomBytes(32).toString('hex'));
"
```

### 6. Upload secrets to GCP Secret Manager

```bash
for s in github-oauth-client-id github-oauth-client-secret oauth-cookie-keys oauth-jwks web-client-secret; do
  gcloud secrets create $s --replication-policy=automatic
done
# Then `gcloud secrets versions add $s --data-file=-` for each.
```

### 7. Configure Firestore TTLs

```bash
for col in AccessToken RefreshToken AuthorizationCode Session Interaction Grant Client RegistrationAccessToken ReplayDetection PushedAuthorizationRequest; do
  gcloud firestore fields ttls update expiresAt --collection-group="oidc_${col}" --enable-ttl --async
done
gcloud firestore fields ttls update expiresAt --collection-group=tasks --enable-ttl --async
```

### 8. Configure GCS bucket lifecycle

Create a bucket (default: `document-ai-mcp-batch-temp`) and apply a per-prefix lifecycle so results and uploads live 30 days but batch intermediates are cleaned in 1 day. See `docs/` or the deployed config for the exact rules.

### 9. Deploy

```bash
gcloud run deploy document-ai-mcp \
  --source . \
  --region us-central1 \
  --memory 2Gi --timeout 600 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT=<p>,SERVICE_URL=<url>,WEB_URL=<dashboard-url>,WEB_CLIENT_ID=document-ai-web,BATCH_BUCKET=<bucket>,WORKER_SA_EMAIL=<sa>,OCR_PROCESSOR=<name>,FORM_PARSER_PROCESSOR=<name>,LAYOUT_PARSER_PROCESSOR=<name>" \
  --set-secrets="GITHUB_OAUTH_CLIENT_ID=github-oauth-client-id:latest,GITHUB_OAUTH_CLIENT_SECRET=github-oauth-client-secret:latest,OAUTH_COOKIE_KEYS=oauth-cookie-keys:latest,WEB_CLIENT_SECRET=web-client-secret:latest,OAUTH_JWKS=oauth-jwks:latest"
```

### 10. Point Cloud Scheduler at `/cleanup`

Create an OIDC-authenticated HTTP scheduler job that POSTs to `https://<url>/cleanup` every 15 minutes to mark zombie tasks as `failed`.

## Environment variables

| Variable | Required | Source | Notes |
|---|---|---|---|
| `GCP_PROJECT` | ✓ | env | Your GCP project ID |
| `SERVICE_URL` | ✓ | env | The Cloud Run URL of this MCP |
| `WEB_URL` | ✓ | env | Base URL of the dashboard. Change this one value when you buy a custom domain |
| `WEB_CLIENT_ID` | ✓ | env | Pre-registered client ID for the web (default `document-ai-web`) |
| `WEB_CLIENT_SECRET` | ✓ | Secret Manager | Shared with the web deployment |
| `BATCH_BUCKET` | ✓ | env | GCS bucket for inputs, outputs, uploads |
| `WORKER_SA_EMAIL` | ✓ | env | Service account email for OIDC tokens |
| `OCR_PROCESSOR` / `FORM_PARSER_PROCESSOR` / `LAYOUT_PARSER_PROCESSOR` | ✓ | env | Document AI processor resource names |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | ✓ | Secret Manager | The MCP's GitHub OAuth App |
| `OAUTH_COOKIE_KEYS` | ✓ | Secret Manager | JSON array of two 32-byte hex keys for `oidc-provider` cookies |
| `OAUTH_JWKS` | ✓ | Secret Manager | JSON Web Key Set with one private EC P-256 key (`ES256`) |

## Swapping the IdP

GitHub is the default identity provider for historic reasons (dev-friendly signup, universal among the target audience), but **the MCP is not locked to GitHub**. Identity delegation is isolated to two small files:

- `src/oauth/github.ts` — ~80 lines. Wraps the external OAuth: exchange `code` for an access token, fetch the user's `id + email + name + avatar`. Purely functional, no side effects.
- `src/oauth/interactions.ts` — the Express router that handles `oidc-provider`'s "interactions" flow. The part that redirects the user to the external IdP and reads them back from the callback.

To use Google, Microsoft, or any OAuth 2.0 / OIDC provider:

1. Write a sibling of `github.ts` — `google.ts`, `microsoft.ts`, etc. Export the same three functions (`authorizeUrl`, `exchangeCodeForAccessToken`, `fetchProfile`) adapted to the provider's API (authorize endpoint, token endpoint, userinfo shape, scopes).
2. Swap the import in `interactions.ts` — `import { ... } from "./google.js"` — or make it runtime-selectable via an env var.
3. Update the OAuth app callback URL in the IdP's dashboard to match `<SERVICE_URL>/oauth/interaction/callback/<provider>`.
4. Replace the `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` env vars with the equivalent for your provider.

The `UserRecord` schema (`users/{userId}`) already uses a generic `githubId` field. If you swap IdP, rename it to something neutral (`externalId`) or add a new field per provider if you want multi-provider support. Migration is a one-off Firestore script.

For full multi-IdP (user picks Google OR GitHub), you'd loop over providers inside `interactions.ts` and route by query param — a couple hours of work, not a rewrite.

## Retention

| What | Where | TTL |
|---|---|---|
| Batch intermediates | `gs://.../batch/` | 1 day |
| Results | `gs://.../results/` | 30 days |
| Uploads | `gs://.../uploads/` | 30 days |
| Tasks (Firestore) | `tasks/` | 90 days |
| OAuth tokens, sessions, grants | `oidc_*/` | 7-30 days depending on kind |
| Users | `users/` | Permanent |

No formal GDPR delete-on-request flow yet — reach out if you need one.

## Development

```bash
pnpm build     # tsc
pnpm dev       # tsc --watch
pnpm test      # vitest (18 unit tests)
```

The code is structured so the pure parts (Markdown formatters, credits math, OAuth helpers) have no dependency on Firestore or Document AI — they're tested with plain data. Infra is thin and opinionated.

```
src/
├── index.ts              # Express app + route wiring
├── server.ts             # MCP server factory
├── oauth/                # oidc-provider + Firestore adapter + GitHub interaction
├── tools/                # 6 MCP tool handlers
├── documentai/           # Document AI client, formatters, online + batch
├── gcs/                  # Storage helpers
├── queue/                # Cloud Tasks enqueue
└── storage/              # Firestore user + task CRUD
```

## Contributing

Issues and PRs welcome. Three principles:
1. **Every file under ~200 lines.** If a module grows past that, split it along a real seam.
2. **Pure core, thin infra.** New business logic lands in a pure function before anything else. Infra wrapping follows.
3. **No shared-secret HTTP auth.** User endpoints are OAuth Bearer; service endpoints are OIDC; webhook endpoints verify provider signatures. No `X-Admin-Key`.

## License

ISC. See [LICENSE](./LICENSE).

## Credits

- [Model Context Protocol](https://modelcontextprotocol.io) by Anthropic
- [`oidc-provider`](https://github.com/panva/node-oidc-provider) by Filip Skokan
- Google Document AI
- The Chesterton's Fence principle, consulted approximately four times during the OAuth migration
