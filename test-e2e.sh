#!/bin/bash
set -e

BASE_URL="https://document-ai-mcp-775459709798.us-central1.run.app"
SA_KEY_FILE="/tmp/test-sa-key.json"

# Use the already registered API key (registration creates duplicates)
API_KEY="rqWGczcRwGQRj2WDL_pGZqm9vwBMIrD-0lZJT1d6CAA"

# Helper: extract JSON from SSE response
parse_sse() {
  grep "^data: " | head -1 | sed 's/^data: //'
}

echo "=== 1. Health check ==="
curl -s "$BASE_URL/health"
echo ""

echo ""
echo "=== 2. Initialize MCP session ==="
curl -s -D /tmp/mcp-headers.txt -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -o /tmp/mcp-init-raw.txt \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0"}
    }
  }'

cat /tmp/mcp-init-raw.txt | parse_sse | python3 -m json.tool
SESSION_ID=$(grep -i "mcp-session-id" /tmp/mcp-headers.txt | tr -d '\r\n' | awk '{print $2}')
echo "Session ID: $SESSION_ID"

echo ""
echo "=== 3. Send initialized notification ==="
curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc": "2.0", "method": "notifications/initialized"}'
echo "(notification sent)"

echo ""
echo "=== 4. List tools ==="
TOOLS_RAW=$(curl -s -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list"
  }')
echo "$TOOLS_RAW" | parse_sse | python3 -c "
import sys, json
data = json.load(sys.stdin)
tools = data.get('result', {}).get('tools', [])
for t in tools:
    print(f\"  - {t['name']}: {t['description'][:70]}...\")
"

echo ""
echo "=== 5. Call ocr_document (URL input — Codigo Civil Argentino) ==="

cat > /tmp/mcp-ocr-request.json << 'ENDJSON'
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "ocr_document",
    "arguments": {
      "url": "https://www.saij.gob.ar/docs-f/codigo/Codigo_Civil_y_Comercial_de_la_Nacion.pdf"
    }
  }
}
ENDJSON

OCR_RAW=$(curl -s --max-time 120 -X POST "$BASE_URL/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "X-API-Key: $API_KEY" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d @/tmp/mcp-ocr-request.json)

echo "$OCR_RAW" | parse_sse | python3 -c "
import sys, json
data = json.load(sys.stdin)
if 'error' in data:
    print('ERROR:', json.dumps(data['error'], indent=2))
elif data.get('result', {}).get('isError'):
    print('TOOL ERROR:', data['result']['content'][0]['text'][:500])
else:
    text = data.get('result', {}).get('content', [{}])[0].get('text', '')
    lines = text.split('\n')
    print(f'Extracted {len(lines)} lines of text')
    print()
    print('--- First 40 lines ---')
    print('\n'.join(lines[:40]))
    print('...')
    print(f'--- Total: {len(text)} characters ---')
"

echo ""
echo "=== Test complete ==="
