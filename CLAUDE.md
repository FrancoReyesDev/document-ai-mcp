# Document AI MCP Server

## Qué es

MCP server remoto que expone Google Document AI como herramientas para cualquier LLM (Claude Desktop, Perplexity, etc.). Reemplaza la vision de LLMs (costosa, lenta, imprecisa) con Document AI (OCR especializado de alta calidad).

## Modelo de acceso

Cualquier user autenticado puede hacer el flow OAuth y crear su user record. Los nuevos usuarios reciben un grant inicial de páginas (default `100`, configurable en código vía `SIGNUP_FREE_PAGES` en `src/storage/firestore.ts`). Cuando se les acaba, el admin del deployment carga más páginas editando directo en Firestore. No hay billing en el código — si querés monetizar, agregás un webhook endpoint que cargue pages al recibir un payment.

## Stack

TypeScript, pnpm, Express 5, MCP SDK 1.28, `oidc-provider` (Panva), Google Cloud (Document AI, Firestore, Cloud Storage, Cloud Tasks)

## Arquitectura

```
External IdP (GitHub por default — configurable) → identity delegation
   ↑
MCP (Cloud Run)
  ├── AS:  /oauth/*          (oidc-provider, DCR abierto, PKCE, refresh, revocation)
  ├── RS:  /mcp              (Streamable HTTP, Bearer auth)
  ├── user:/me, /me/usage    (Bearer auth)
  └── OIDC:/worker, /cleanup (Cloud Tasks, Cloud Scheduler)

Firestore:
  ├── users/{userId}     = identity + credits
  └── oidc_*/{id}        = AS state (managed by oidc-provider Firestore adapter)

Cloud Tasks → POST /worker → OIDC verify → processDocument() → GCS results
Cloud Scheduler → POST /cleanup → OIDC verify → zombie task cleanup
```

**IdP pluggable.** GitHub es el default pero `src/oauth/github.ts` + `src/oauth/interactions.ts` son reemplazables por Google / Microsoft / cualquier OAuth 2.0 provider con mínimas modificaciones (cambia el URL del authorize, el shape del profile fetch, y el scope). La identidad federada pasa siempre por el mismo mecanismo de "interactions" de `oidc-provider`.

**OAuth clients pre-registrados** (como el dashboard propio del admin) se declaran en `provider.ts`. DCR abierto permite a Claude/Perplexity registrarse dinámicamente.

## Endpoints

| Endpoint | Auth | Quién lo llama |
|----------|------|----------------|
| `GET /health` | Ninguna | Monitoreo |
| `GET /.well-known/oauth-protected-resource` | Ninguna | MCP clients (discovery) |
| `GET /.well-known/oauth-authorization-server` | Ninguna | MCP clients (discovery) |
| `/oauth/*` | OAuth protocol | Claude Desktop, Perplexity, web dashboard |
| `POST/GET/DELETE /mcp` | Bearer (user token) | LLM clients vía MCP |
| `GET /me`, `GET /me/usage` | Bearer | Web dashboard |
| `POST /worker` | OIDC Cloud Tasks | Cloud Tasks |
| `POST /cleanup` | OIDC Cloud Scheduler | Cloud Scheduler |

**Eliminados en la migración:** `POST /register`, todo `/admin/*`. Admin humano = Firebase Console.

## MCP Tools (6)

1. **`ocr_document`** — OCR: texto extraído como Markdown. Encola y retorna taskId.
2. **`parse_form`** — Form Parser: campos clave-valor como tabla Markdown.
3. **`parse_layout`** — Layout Parser: estructura del documento (headings, tablas, listas).
4. **`get_result`** — Consultar estado de task. Sin params → metadata (total páginas, chars). Con `pageFrom/pageTo` → contenido paginado.
5. **`upload_document`** — Subir documento a GCS (base64 o URL con streaming). Retorna URI permanente.
6. **`get_quota`** — Consultar páginas disponibles y uso.

Input común para tools 1-3: `{ content?, mimeType?, gcsUri?, url? }`

## Auth model

### Para LLM clients (Claude Desktop, Perplexity)

1. Client descubre auth vía `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server`.
2. Si es necesario, DCR en `/oauth/reg` → obtiene `client_id`.
3. Client redirige al user a `/oauth/auth` con PKCE.
4. MCP hace interaction: redirige al user browser a GitHub OAuth.
5. GitHub redirige de vuelta al MCP → MCP resuelve identity, upsert user en Firestore (con `pagesAvailable: 0` si es nuevo).
6. MCP emite authorization code → client exchange en `/oauth/token` → access_token + refresh_token.
7. Client usa `Bearer <access_token>` en `/mcp`.

### Para el web dashboard

Mismo flow, pero con `client_id="document-ai-web"` pre-registrado (no DCR). Shared `WEB_CLIENT_SECRET` entre MCP y web.

### Para Cloud Tasks / Cloud Scheduler

OIDC token firmado por el service account. Verificado por el MCP con `google-auth-library`.

## Flujo de procesamiento

```
1. LLM client → ocr_document({ url }) con Bearer
   → oauthTokenAuth valida token, resuelve userContext { userId, email, credits }
   → credits.pagesAvailable > 0? Si no, error amigable.
   → enqueue Cloud Task, return taskId

2. Cloud Tasks → POST /worker con OIDC
   → verifyOidc OK
   → resolvePageCount(input) → chequea <= MAX_PAGES_PER_DOC (2000)
   → chequea <= pagesAvailable
   → processDocument() (online ≤15 pags con fallback a batch ≤2000)
   → format to Markdown, split pages, upload to GCS
   → consumePages(userId, pages.length)
   → update task status

3. LLM → get_result(taskId) → metadata o páginas específicas desde GCS
```

## Estructura del proyecto (post-migración)

```
src/
├── index.ts                    # Express app + routes + oauth mount + graceful shutdown
├── server.ts                   # McpServer factory + registro de tools
├── types.ts                    # UserRecord, UserContext, constants (MAX_PAGES_PER_DOC)
├── logger.ts                   # Logging JSON (Cloud Logging compatible)
├── worker.ts                   # Cloud Tasks worker (OIDC verify, processing)
├── cleanup.ts                  # Zombie task cleanup (OIDC Cloud Scheduler)
│
├── oauth/
│   ├── index.ts                # Barrel
│   ├── provider.ts             # oidc-provider config (clients, features, findAccount)
│   ├── firestore-adapter.ts    # Adapter interface → Firestore oidc_* collections
│   ├── interactions.ts         # Login flow via GitHub (redirect + callback)
│   ├── github.ts               # Puro: code exchange, user info fetch
│   └── middleware.ts           # oauthTokenAuth (Bearer validation)
│
├── tools/                      # 6 MCP tool handlers (usan userContext.userId)
├── documentai/                 # Document AI client, formatters, batch
├── gcs/                        # Cloud Storage operations
├── queue/                      # Cloud Tasks enqueue
└── storage/
    ├── index.ts                # Barrel
    └── firestore.ts            # User CRUD (by userId, by githubId), task CRUD, consumePages, addPages
```

**Eliminados en la migración:** `src/auth/api-key.ts`, `src/auth/middleware.ts`, `src/auth/admin-auth.ts`, `src/admin.ts`, `src/register.ts`.

## Capas

- **Puro (negocio)**: `oauth/github.ts` (helpers), `format-*.ts`, `split-pages.ts`, `types.ts`
- **Infra**: `firestore.ts`, `oauth/firestore-adapter.ts`, `documentai/client.ts`, `gcs/`, `queue/`
- **Aplicación**: `tools/*.ts`, `worker.ts`, `cleanup.ts`, `oauth/interactions.ts`, `oauth/middleware.ts`
- **Transport / protocol**: `index.ts`, `server.ts`, `oauth/provider.ts`

## Cloud Run

- Dockerfile multi-stage (node:22-slim)
- Port 8080, min 0, max 10 instancias
- Memory 2GB, timeout 600s
- SA necesita: `roles/datastore.user`, `roles/storage.admin` (batch bucket), `roles/cloudtasks.enqueuer`
- Trust proxy + cookies `Secure` configurados para `oidc-provider` detrás del HTTPS de Cloud Run

## Variables de entorno

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `GCP_PROJECT` | env | Proyecto GCP |
| `OCR_PROCESSOR` | env | Resource name del procesador OCR |
| `FORM_PARSER_PROCESSOR` | env | Resource name del Form Parser |
| `LAYOUT_PARSER_PROCESSOR` | env | Resource name del Layout Parser |
| `SERVICE_URL` | env | URL del propio Cloud Run (= issuer del AS) |
| `WORKER_SA_EMAIL` | env | SA email para OIDC tokens (Cloud Tasks / Scheduler) |
| `BATCH_BUCKET` | env | Bucket GCS para batch + resultados |
| `GITHUB_OAUTH_CLIENT_ID` | env | OAuth app del MCP para identity delegation |
| `GITHUB_OAUTH_CLIENT_SECRET` | Secret Manager | Idem |
| `OAUTH_COOKIE_KEYS` | Secret Manager | JSON array de 2 hex-32-byte keys para cookies internas del provider |
| `WEB_CLIENT_SECRET` | Secret Manager | Shared con el web para client authentication del OAuth flow |

**Eliminadas en la migración:** `ADMIN_SECRET`, `ADMIN_EMAILS`.

## Firestore

- **Collection `users`**: `{userId}` (UUID generado al primer OAuth). Fields: `userId`, `githubId`, `email`, `name`, `avatarUrl`, `credits {pagesAvailable, pagesUsedTotal, pagesUsedThisMonth, currentMonth}`, `createdAt`, `lastUsedAt`.
- **Collection `tasks`**: `{taskId}`. Fields: `taskId`, `userId`, `toolName`, `input`, `status`, `resultGcsUri`, `error`, `createdAt`, `completedAt`, `pageCount?`, `startedAt?`, `expiresAt`.
- **Collections `oidc_*`**: managed by oidc-provider Firestore adapter (grants, sessions, interactions, access_tokens, refresh_tokens, authorization_codes, clients). TTL configurado via `expiresAt` field + gcloud Firestore TTL policy.

Firestore client se inicializa con `ignoreUndefinedProperties: true` — necesario porque `oidc-provider` a veces escribe campos con valor `undefined` (ej. `extra`), que Firestore rechazaría por default.

## GCS Bucket

`document-ai-mcp-batch-temp` con lifecycle per-prefix.

Estructura:
```
batch/{userHash}/{uuid}/input.pdf      # Input temporal para batch
batch/{userHash}/{uuid}/output/*.json  # Output de batch (Document AI shards)
results/{taskId}/metadata.json         # Metadata de resultado
results/{taskId}/page-1.md             # Páginas individuales
uploads/{userHash}/{uuid}/file.pdf     # Documentos subidos por upload_document
```

## Retention policy

| Artefacto | Ubicación | TTL | Mecanismo |
|---|---|---|---|
| Batch intermediates | GCS `batch/` | 1 día | GCS lifecycle rule `age=1 + matchesPrefix=["batch/"]` |
| Results (pages + metadata) | GCS `results/` | 30 días | GCS lifecycle rule `age=30 + matchesPrefix=["results/"]` |
| Uploads (docs subidos por user) | GCS `uploads/` | 30 días | GCS lifecycle rule `age=30 + matchesPrefix=["uploads/"]` |
| Tasks | Firestore `tasks/` | 90 días | Campo `expiresAt` seteado en `createTask` a `createdAt + 90d` + TTL policy |
| OAuth state (tokens, grants, sessions) | Firestore `oidc_*` | Heredado del TTL del modelo (access 7d / refresh 30d / code 10m / session 14d / grant 14d) | Campo `expiresAt` seteado por el adapter + TTL policy |
| Users | Firestore `users/` | **Sin TTL** | Permanentes |

**Razones:**
- Batch intermediates son descartables post-processing — sufficient 1d.
- Results/uploads guardan 30d por si el user quiere volver sobre un resultado o re-procesar, sin ser storage waste eterno.
- Tasks 90d para debugging + historial visible en dashboard.
- Sin compliance/GDPR flow formal por ahora — cuando surja, se implementa delete-on-request.

## Operator runbook

### Cargar créditos a un user

Opción Firebase Console (GUI):
1. `https://console.firebase.google.com/project/document-ai-mcp/firestore` → `users/`
2. Buscar doc con el email del user.
3. Editar `credits.pagesAvailable` → `1000000000` (para "unlimited práctico").

Opción gcloud (scripteable):
```bash
gcloud firestore documents update users/<userId> \
  --update-mask=credits.pagesAvailable \
  --data='{"credits":{"pagesAvailable":1000000000}}' \
  --project=document-ai-mcp
```

### Revocar un token emitido

Via endpoint estándar OAuth: `POST /oauth/token/revocation` con el token. O directamente borrar el doc de `oidc_access_tokens`.

### Eliminar un user (kick out)

Borrar `users/{userId}` en Firestore. Los tokens activos quedan pero van a fallar el `findAccount` → 401 en próximo request.

## Valores

- Eficiencia, simpleza, minimalismo
- No over-engineer
- Max ~200 líneas por archivo
- Barrels por directorio
- Funciones puras donde sea posible
- Zero shared-secret HTTP auth. Cada endpoint tiene auth real (Bearer / OIDC / webhook signature).
