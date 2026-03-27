# Document AI MCP Server

## Qué es

MCP server remoto que expone Google Document AI como herramientas para cualquier LLM (Claude, Perplexity, etc.). Reemplaza la vision de LLMs (costosa, lenta, imprecisa) con Document AI (OCR especializado de alta calidad).

## Modelo de negocio

SaaS: nosotros pagamos GCP (Document AI, GCS, etc.), el usuario paga subscription por páginas mensuales. Plans: free (100 pags/mes), basic (1,000), pro (10,000). Admin emails reciben plan pro automáticamente.

## Stack

TypeScript, pnpm, Express 5, MCP SDK 1.28, Google Cloud (Document AI, Firestore, Cloud Storage, Cloud Tasks)

## Arquitectura

```
LLMs (Claude, Perplexity) ──MCP──→ Cloud Run (este server) ──→ Document AI
CF Billing App ──HTTP──→ Cloud Run (admin API) ──→ Firestore
Cloud Tasks ──HTTP──→ Cloud Run (/worker) ──→ Document AI + GCS
Cloud Scheduler ──HTTP──→ Cloud Run (/cleanup)
```

## Endpoints

| Endpoint | Auth | Quién lo llama |
|----------|------|----------------|
| `GET /health` | Ninguna | Monitoreo |
| `POST/GET/DELETE /mcp` | API key usuario | LLMs via MCP |
| `POST /register` | Admin key | CF frontend |
| `/admin/*` | Admin key | CF frontend |
| `POST /worker` | OIDC Cloud Tasks | Cloud Tasks |
| `POST /cleanup` | Admin key | Cloud Scheduler |

## MCP Tools (7)

1. **`ocr_document`** — OCR: texto extraído como Markdown. Encola y retorna taskId.
2. **`parse_form`** — Form Parser: campos clave-valor como tabla Markdown.
3. **`parse_layout`** — Layout Parser: estructura del documento (headings, tablas, listas).
4. **`get_result`** — Consultar estado de task. Sin params → metadata (total páginas, chars). Con `pageFrom/pageTo` → contenido paginado.
5. **`upload_document`** — Subir documento a GCS (base64 o URL con streaming). Retorna URI permanente.
6. **`get_quota`** — Consultar plan, páginas usadas/restantes este mes.

Input común para tools 1-3: `{ content?, mimeType?, gcsUri?, url? }`

## Admin API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| POST | `/admin/users` | Crear usuario (email, plan?) → API key |
| GET | `/admin/users/:email` | Info del usuario (plan, quota, fechas) |
| GET | `/admin/users/:email/usage` | Quota + tasks recientes |
| POST | `/admin/users/:email/rotate-key` | Rotar API key |
| POST | `/admin/users/:email/upgrade` | Cambiar plan |
| DELETE | `/admin/users/:email` | Eliminar usuario |

Protegida con `X-Admin-Key` header (shared secret en Secret Manager).

## Flujo de procesamiento

```
1. LLM → ocr_document({ url }) → quota check → enqueue Cloud Task → return taskId
2. Cloud Tasks → POST /worker → OIDC verify → processDocument()
   → try online (≤15 pags) → fallback batch (≤2000 pags)
   → format to Markdown → split pages → upload to GCS
   → increment quota → update task status
3. LLM → get_result(taskId) → metadata o páginas específicas
```

## Estructura del proyecto

```
src/
├── index.ts                    # Express app + rutas + graceful shutdown
├── server.ts                   # McpServer factory + registro de 7 tools
├── types.ts                    # Interfaces compartidas
├── logger.ts                   # Logging JSON (Cloud Logging compatible)
├── register.ts                 # POST /register (admin auth)
├── admin.ts                    # Admin REST API (/admin/users/*)
├── worker.ts                   # Worker (Cloud Tasks, OIDC, procesamiento)
├── cleanup.ts                  # Zombie task cleanup (Cloud Scheduler)
│
├── auth/
│   ├── index.ts                # Barrel
│   ├── api-key.ts              # Puro: generate, hash
│   ├── middleware.ts           # API key auth (X-API-Key + Bearer)
│   └── admin-auth.ts           # Admin key auth (X-Admin-Key)
│
├── tools/
│   ├── index.ts                # Barrel
│   ├── schema.ts               # Zod schema compartido
│   ├── ocr-document.ts         # Tool ocr_document
│   ├── parse-form.ts           # Tool parse_form
│   ├── parse-layout.ts         # Tool parse_layout
│   ├── get-result.ts           # Tool get_result (paginado)
│   ├── upload-document.ts      # Tool upload_document
│   └── get-quota.ts            # Tool get_quota
│
├── documentai/
│   ├── index.ts                # Barrel
│   ├── client.ts               # Singleton Document AI client (ADC)
│   ├── process.ts              # Online + fallback batch
│   ├── batch-process.ts        # Batch: upload, LRO, shard merge
│   ├── split-pages.ts          # Puro: split markdown por páginas
│   ├── format-ocr.ts           # Puro: response → markdown
│   ├── format-form.ts          # Puro: response → tabla markdown
│   └── format-layout.ts        # Puro: response → markdown estructura
│
├── gcs/
│   ├── index.ts                # Barrel
│   ├── client.ts               # Singleton Storage client (ADC)
│   └── operations.ts           # Upload, download, paginación, streaming
│
├── queue/
│   ├── index.ts                # Barrel
│   ├── client.ts               # Singleton Cloud Tasks client
│   └── enqueue.ts              # Quota check + enqueue
│
└── storage/
    ├── index.ts                # Barrel
    └── firestore.ts            # User CRUD, task CRUD, quota, admin ops
```

## Capas

- **Puro (negocio)**: `api-key.ts`, `format-*.ts`, `split-pages.ts`, `schema.ts`, `types.ts`
- **Infra**: `firestore.ts`, `client.ts`, `process.ts`, `operations.ts`, `queue/`
- **Aplicación**: `tools/*.ts`, `worker.ts`, `register.ts`, `admin.ts`
- **Transport**: `index.ts`, `server.ts`

## Cloud Run

- Dockerfile multi-stage (node:22-slim)
- Port 8080, min 0, max 10 instancias
- Memory 2GB, timeout 600s
- SA necesita: `roles/datastore.user`, `roles/storage.admin` (batch bucket), `roles/cloudtasks.enqueuer`

## Variables de entorno

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `GCP_PROJECT` | env | Proyecto GCP |
| `OCR_PROCESSOR` | env | Resource name del procesador OCR |
| `FORM_PARSER_PROCESSOR` | env | Resource name del Form Parser |
| `LAYOUT_PARSER_PROCESSOR` | env | Resource name del Layout Parser |
| `SERVICE_URL` | env | URL del propio Cloud Run |
| `WORKER_SA_EMAIL` | env | SA email para OIDC tokens |
| `BATCH_BUCKET` | env | Bucket GCS para batch + resultados |
| `ADMIN_EMAILS` | env | Emails que reciben plan pro automático |
| `ADMIN_SECRET` | Secret Manager | Shared secret para admin API |

## GCS Bucket

`document-ai-mcp-batch-temp` con lifecycle auto-delete 1 día.

Estructura:
```
{userHash}/{uuid}/input.pdf          # Input para batch
{userHash}/{uuid}/output/*.json      # Output de batch (Document AI shards)
results/{taskId}/metadata.json       # Metadata de resultado
results/{taskId}/page-1.md           # Páginas individuales
uploads/{userHash}/{uuid}/file.pdf   # Documentos subidos por upload_document
```

## Firestore

- **Collection `users`**: apiKeyHash (doc ID), email, plan, quota, fechas
- **Collection `tasks`**: taskId (doc ID), userId, toolName, input, status, resultGcsUri, error, fechas
- Quota auto-reset mensual

## Valores

- Eficiencia, simpleza, minimalismo
- No over-engineer
- Max ~200 líneas por archivo
- Barrels por directorio
- Funciones puras donde sea posible
