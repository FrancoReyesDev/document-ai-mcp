# Document AI MCP Server

Remote MCP server that exposes Google Document AI as tools for any LLM. High-quality OCR, form parsing, and layout analysis — faster, cheaper, and more accurate than LLM vision.

## Tools

| Tool | Description |
|------|-------------|
| `ocr_document` | Extract text from PDFs/images as Markdown |
| `parse_form` | Extract form fields as key-value Markdown table |
| `parse_layout` | Analyze document structure (headings, tables, lists) |
| `get_result` | Check task status and retrieve paginated results |
| `upload_document` | Upload a document to cloud storage (base64 or URL) |
| `get_quota` | Check your monthly page usage and limits |

## How it works

1. Connect your LLM (Claude, Perplexity, etc.) to the MCP server
2. Call `ocr_document` with a PDF — returns a task ID instantly
3. Call `get_result` to check status and retrieve extracted text by page range
4. Large documents (100+ pages) are processed automatically via batch

## Connect your MCP client

**URL:** `https://document-ai-mcp-775459709798.us-central1.run.app/mcp`
**Auth:** API Key (via `Authorization: Bearer <key>` or `X-API-Key: <key>`)
**Transport:** Streamable HTTP

### Example: Perplexity

1. Go to MCP settings
2. Add remote MCP server
3. URL: `https://document-ai-mcp-775459709798.us-central1.run.app/mcp`
4. Auth: API Key → paste your key
5. Transport: HTTP Stream

## Usage flow

```
You: "Extract the text from this contract"

LLM → upload_document({ url: "https://..." })
    → "GCS URI: gs://..."

LLM → ocr_document({ gcsUri: "gs://..." })
    → "Task ID: abc123"

LLM → get_result({ taskId: "abc123" })
    → "3 pages, 1410 characters"

LLM → get_result({ taskId: "abc123", pageFrom: 1, pageTo: 3 })
    → "## Page 1\nCONTRATO DE LOCACION..."
```

## Plans

| Plan | Pages/month | Price |
|------|-------------|-------|
| Free | 100 | $0 |
| Basic | 1,000 | TBD |
| Pro | 10,000 | TBD |

## Admin API

For the billing frontend to manage users. Protected with `X-Admin-Key` header.

```
POST   /admin/users              — Create user
GET    /admin/users/:email       — Get user info
GET    /admin/users/:email/usage — Get quota + recent tasks
POST   /admin/users/:email/rotate-key — Rotate API key
POST   /admin/users/:email/upgrade    — Change plan
DELETE /admin/users/:email       — Delete user
```

## Self-hosting

```bash
# Clone
git clone <repo-url>
cd document-ai-mcp

# Install
pnpm install

# Configure (see .env.example)
cp .env.example .env

# Build & run
pnpm build
node dist/index.js

# Deploy to Cloud Run
gcloud run deploy document-ai-mcp --source . --region us-central1
```

### Requirements

- GCP project with Document AI, Firestore, Cloud Storage, Cloud Tasks enabled
- Document AI processors created (OCR, Form Parser, Layout Parser)
- Cloud Run with 2GB memory, 600s timeout

## Tech stack

TypeScript, Express 5, MCP SDK, Google Cloud (Document AI, Firestore, Cloud Storage, Cloud Tasks, Cloud Run)
