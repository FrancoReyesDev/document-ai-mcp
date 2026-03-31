# Document OCR MCP

Enterprise document processing for AI agents via [MCP](https://modelcontextprotocol.io). Connect Google Document AI to Claude, Perplexity, or any LLM — extract text, parse forms, analyze layouts with industrial-grade OCR.

> Faster, cheaper, and more accurate than LLM vision. Up to 2,000 pages per document.

## Why

LLM vision is slow, expensive, and imprecise for documents. Google Document AI is purpose-built for OCR with 99%+ accuracy. This MCP server bridges the gap — any LLM can process documents at enterprise quality without vision tokens.

## Tools

| Tool | Description |
|------|-------------|
| `ocr_document` | Extract text from PDFs/images → Markdown |
| `parse_form` | Extract form fields → key-value Markdown table |
| `parse_layout` | Analyze structure → headings, tables, lists, reading order |
| `get_result` | Check task status, retrieve paginated results |
| `upload_document` | Upload document to storage (base64 or URL) |
| `get_quota` | Check plan, pages used, remaining |

## Quick start

### 1. Connect

```
URL:       https://your-server.run.app/mcp
Auth:      API Key (Authorization: Bearer <key>)
Transport: Streamable HTTP
```

Works with Claude Desktop, Perplexity, Claude Code, or any MCP-compatible client.

### 2. Process

```
You: "Extract the text from this contract"

LLM → ocr_document({ url: "https://..." })
    → Task ID: abc123

LLM → get_result({ taskId: "abc123" })
    → "3 pages, 1410 characters"

LLM → get_result({ taskId: "abc123", pageFrom: 1, pageTo: 3 })
    → "## Page 1\nCONTRATO DE LOCACION..."
```

All processing is async via Cloud Tasks. Documents up to 15 pages process online (~3s), larger ones automatically batch process.

## Architecture

```
LLM ──MCP──→ Cloud Run ──→ Document AI
                │
                ├── Cloud Tasks (async queue, rate limited)
                ├── Firestore (users, tasks, quota)
                └── Cloud Storage (documents, results)
```

- **Async processing**: Cloud Tasks queue with 5 concurrent / 2 per second rate limit
- **Paginated results**: Each page stored separately — LLM requests only what it needs
- **Page counting**: pdf-lib validates page count before processing (prevents cost blowouts)
- **Quota system**: Monthly page limits per plan with auto-reset
- **Batch fallback**: Online processing (≤15 pages) with transparent fallback to batch (≤2,000 pages)

## Self-hosting

### Prerequisites

- GCP project with billing enabled
- Node.js 22+, pnpm

### Setup

```bash
git clone https://github.com/FrancoReyesDev/document-ai-mcp.git
cd document-ai-mcp
pnpm install
```

### Enable GCP APIs

```bash
gcloud services enable \
  documentai.googleapis.com \
  firestore.googleapis.com \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  storage.googleapis.com
```

### Create Document AI processors

```bash
# Create OCR, Form Parser, Layout Parser processors
# via GCP Console or REST API (see CLAUDE.md for details)
```

### Configure

```bash
cp .env.example .env
# Edit .env with your GCP project, processor IDs, etc.
```

### Run locally

```bash
pnpm build
node dist/index.js
```

### Deploy to Cloud Run

```bash
gcloud run deploy document-ai-mcp \
  --source . \
  --region us-central1 \
  --memory 2Gi \
  --timeout 600 \
  --allow-unauthenticated
```

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GCP_PROJECT` | Yes | GCP project ID |
| `OCR_PROCESSOR` | Yes | OCR processor resource name |
| `FORM_PARSER_PROCESSOR` | Yes | Form Parser processor resource name |
| `LAYOUT_PARSER_PROCESSOR` | Yes | Layout Parser processor resource name |
| `SERVICE_URL` | Yes | Cloud Run service URL (for Cloud Tasks callbacks) |
| `WORKER_SA_EMAIL` | Yes | Service account email for OIDC |
| `BATCH_BUCKET` | No | GCS bucket for batch processing (default: `document-ai-mcp-batch-temp`) |
| `ADMIN_SECRET` | No | Shared secret for admin API (Secret Manager recommended) |
| `ADMIN_EMAILS` | No | Comma-separated admin emails (get pro plan automatically) |

## Admin API

REST API for managing users. Protected with `X-Admin-Key` header.

```
POST   /admin/users              — Create user (email, plan?)
GET    /admin/users/:email       — Get user info
GET    /admin/users/:email/usage — Quota + recent tasks
POST   /admin/users/:email/rotate-key — Rotate API key
POST   /admin/users/:email/upgrade    — Change plan
DELETE /admin/users/:email       — Delete user
```

## Plans

| Plan | Pages/month | Max pages/doc | Price |
|------|-------------|---------------|-------|
| Free | 100 | 50 | $0 |
| Basic | 1,000 | 500 | $19/mo |
| Pro | 10,000 | 2,000 | $49/mo |

## Tech stack

TypeScript, pnpm, Express 5, MCP SDK 1.28, Google Cloud (Document AI, Firestore, Cloud Storage, Cloud Tasks, Cloud Run)

## Project structure

```
src/
├── index.ts              # Express app + MCP transport + routes
├── server.ts             # McpServer factory (7 tools)
├── worker.ts             # Cloud Tasks worker (OIDC, processing)
├── admin.ts              # Admin REST API
├── register.ts           # Registration endpoint
├── cleanup.ts            # Zombie task cleanup
├── logger.ts             # Structured JSON logging
├── types.ts              # Shared interfaces
├── auth/                 # API key + admin key auth
├── tools/                # 7 MCP tool handlers
├── documentai/           # Document AI client, formatters, batch
├── gcs/                  # Cloud Storage operations
├── queue/                # Cloud Tasks enqueue + quota
└── storage/              # Firestore user + task CRUD
```

## License

ISC
