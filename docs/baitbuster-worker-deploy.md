# BaitBuster Worker Deployment

## Runtime configuration

```text
Worker name: thefloew-baitbuster
Production URL: https://thefloew-baitbuster.thefloewback.workers.dev
Workers AI binding variable: AI
KV binding variable: BAITBUSTER_CACHE
Optional text variable: AI_MODEL=@cf/meta/llama-3.3-70b-instruct-fp8-fast\nOptional text variable: AI_GATE_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8
Allowed site origin: https://xn--flw-tna.tr
```

BaitBuster uses Cloudflare Workers AI directly through the `AI` binding. A conservative 8B gate filters only clearly non-clickbait headlines at confidence 0.90 or above; every uncertain or suspicious headline is rechecked by the 70B model, and rewrites remain on 70B. No OpenAI API key or other external model API key is required.

## Cloudflare Dashboard deployment

1. Open **Cloudflare → Workers & Pages → thefloew-baitbuster**.
2. Open **Bindings → Add binding → Workers AI** and set the variable name to `AI`.
3. Open **Bindings → Add binding → KV Namespace** and bind `thefloew-baitbuster-cache` as `BAITBUSTER_CACHE`.
4. Open **Edit code** and replace the Worker code with `baitbuster-worker/worker.js`.
5. Deploy.
6. Optional: add plaintext variable `AI_MODEL` to override the 70B classifier/rewriter model. If omitted, BaitBuster uses `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.\n7. Optional: add plaintext variable `AI_GATE_MODEL` to override the first-pass gate. If omitted, BaitBuster uses `@cf/meta/llama-3.1-8b-instruct-fp8`.

## Verification

Health:

```bash
curl -i https://thefloew-baitbuster.thefloewback.workers.dev/health
```

Expected body:

```json
{"ok":true,"service":"thefloew-baitbuster","version":"1.6.2"}
```

CORS preflight:

```bash
curl -i -X OPTIONS \
  -H 'Origin: https://xn--flw-tna.tr' \
  -H 'Access-Control-Request-Method: POST' \
  https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate
```

Expected: HTTP `204` and `Access-Control-Allow-Origin: https://xn--flw-tna.tr`.

## API contract

`POST /v1/evaluate` requires the exact Flöw production Origin header and JSON:

```json
{"stories":[{"key":"...","url":"https://...","title":"...","description":"...","source":"...","category":"..."}]}
```

Maximum batch size: 12 stories. The Worker checks KV first, classifies uncached headlines with Workers AI, fetches full article text only for suspicious stories, and falls back to the original headline if AI or article extraction fails.
