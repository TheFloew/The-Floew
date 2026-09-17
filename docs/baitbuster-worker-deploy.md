# BaitBuster Worker Deployment

## Runtime configuration

```text
Worker name: thefloew-baitbuster
Production URL: https://thefloew-baitbuster.thefloewback.workers.dev
KV binding variable: BAITBUSTER_CACHE
Secret: OPENAI_API_KEY
Optional text variable: OPENAI_MODEL=gpt-5.6-luna
Allowed site origin: https://xn--flw-tna.tr
```

The Worker uses the OpenAI Responses API. Keep `OPENAI_API_KEY` only as a Cloudflare Worker secret; never place it in GitHub or browser JavaScript.

## Cloudflare Dashboard deployment

1. Open **Cloudflare → Workers & Pages → Create Worker** and create `thefloew-baitbuster`.
2. Deploy the ES-module files from `baitbuster-worker/src/`: `index.js`, `core.js`, `article.js`, and `openai.js`. The entry module is `index.js`. Wrangler may be used instead of the dashboard editor.
3. Create a Workers KV namespace named `thefloew-baitbuster-cache`.
4. In the Worker's **Bindings**, bind that KV namespace as `BAITBUSTER_CACHE`.
5. In **Variables and Secrets**, add secret `OPENAI_API_KEY`.
6. Optionally add text variable `OPENAI_MODEL` with value `gpt-5.6-luna`. If omitted, the Worker uses that model by default.
7. Deploy.
8. Verify health:

```bash
curl -i https://thefloew-baitbuster.thefloewback.workers.dev/health
```

Expected body:

```json
{"ok":true,"service":"thefloew-baitbuster","version":"1.0.0"}
```

9. Verify CORS preflight:

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

Maximum batch size: 12 stories. The Worker returns cached or newly evaluated BaitBuster results. AI/article failures degrade to the original headline and do not break the batch.
