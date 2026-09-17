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

OpenAI API billing is separate from ChatGPT billing. The API account must have its own usable billing/credits before BaitBuster can make model calls.

## Cloudflare Dashboard deployment

1. Open **Cloudflare → Workers & Pages → Create application**.
2. Choose **Start with Hello World! → Get started** (or the equivalent Worker-only starter shown in the current dashboard).
3. Name the Worker `thefloew-baitbuster` and deploy the starter once.
4. Open the Worker editor and replace the starter with the ES-module files from `baitbuster-worker/src/`: `index.js`, `core.js`, `article.js`, and `openai.js`. The entry module is `index.js`.
5. Open **Workers KV → Create instance** and create a namespace named `thefloew-baitbuster-cache`.
6. Return to the Worker → **Settings → Bindings → Add → KV Namespace**. Set **Variable name** to `BAITBUSTER_CACHE`, choose `thefloew-baitbuster-cache`, then deploy the binding.
7. Open Worker → **Settings → Variables and Secrets → Add**. Add `OPENAI_API_KEY` as type **Secret**, paste the API key value, and deploy.
8. Optionally add plaintext variable `OPENAI_MODEL` with value `gpt-5.6-luna`. If omitted, the Worker uses that model by default.
9. Deploy the Worker code.

## Verification

Health:

```bash
curl -i https://thefloew-baitbuster.thefloewback.workers.dev/health
```

Expected body:

```json
{"ok":true,"service":"thefloew-baitbuster","version":"1.0.0"}
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

Maximum batch size: 12 stories. The Worker returns cached or newly evaluated BaitBuster results. AI/article failures degrade to the original headline and do not break the batch.
