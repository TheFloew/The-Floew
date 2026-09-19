# BaitBuster β Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BaitBuster β pipeline so every surfaced Flöw story can be semantically classified for clickbait, suspicious stories can be verified against article text and rewritten, and the beta UI can show the rewritten headline without blocking the normal news flow.

**Architecture:** Keep the existing News Worker untouched. The beta page sends story metadata asynchronously to a separate Cloudflare Worker at `https://thefloew-baitbuster.thefloewback.workers.dev`. That worker checks KV cache first, classifies uncached stories with the OpenAI Responses API, fetches article text only for suspicious stories, rewrites only when enough factual content is available, caches the result, and returns results to the beta client. The client applies `flowTitle` visually while preserving the original title for existing share/feedback behavior.

**Tech Stack:** Vanilla JavaScript, Cloudflare Workers, Cloudflare KV, OpenAI Responses API with Structured Outputs, Node.js built-in `node:test` for pure-function tests.

**Spec:** `docs/superpowers/specs/2026-09-17-baitbuster-beta-design.md`

> **Implementation update — 2026-09-19:** OpenAI-specific implementation details below are superseded by Cloudflare Workers AI. Runtime inference now uses the `AI` binding, default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, and Cloudflare JSON Mode with JSON Schema. No external API key is required. Source file `baitbuster-worker/src/ai.js` replaces `src/openai.js`. All non-model architecture, cache, article-fetch, client, and acceptance requirements remain unchanged.


## Global Constraints

- Main `flöw.tr/` behavior must not change.
- BaitBuster is visible only under `flöw.tr/baitbusterbeta/` during beta.
- No fixed keyword list is used for clickbait detection.
- Every surfaced story may be sent for semantic metadata classification.
- Article body fetching happens only after the classifier marks a story as suspicious and needing article verification.
- The browser never waits for AI before showing a story.
- If any AI, cache, network, parsing, or article extraction step fails, the original title remains visible.
- `title` is never overwritten in the underlying story model; `flowTitle` is a separate value.
- API keys stay in Worker secrets only.
- The AI Worker accepts requests only from the Flöw origin and rejects unsafe article URLs.
- Use `gpt-5.6-luna` for the beta classifier/rewriter because it is the current cost-sensitive, high-volume GPT-5.6 model and supports the Responses API. If production evaluation later shows quality is insufficient, model choice can be changed without changing the API contract.

---

## File Structure

- Create `baitbuster-worker/src/core.js` — pure normalization, cache-key, validation, result-shaping helpers.
- Create `baitbuster-worker/src/openai.js` — OpenAI Responses API calls and strict JSON-schema output handling.
- Create `baitbuster-worker/src/article.js` — SSRF checks, article fetch limits, HTML text extraction.
- Create `baitbuster-worker/src/index.js` — Cloudflare Worker routes, CORS, KV cache orchestration, batching and error fallback.
- Create `baitbuster-worker/test/core.test.mjs` — pure helper tests.
- Create `baitbuster-worker/test/article.test.mjs` — URL-safety and extraction helper tests.
- Create `baitbuster-worker/package.json` — Node test script only.
- Create `js/baitbuster-beta.js` — beta-only DOM observer, background batching, result application and `✦` marker.
- Modify `baitbusterbeta/index.html` — load the beta script after the existing Flöw scripts and add marker styling.
- Modify `js/share.js` — only add a gated fallback that reads `data-baitbuster-original-title` when present; behavior is unchanged everywhere else.
- Create `docs/baitbuster-worker-deploy.md` — exact Cloudflare binding/secret names and deployment checklist.

---

### Task 1: Pure BaitBuster Core Contract

**Files:**
- Create: `baitbuster-worker/src/core.js`
- Create: `baitbuster-worker/test/core.test.mjs`
- Create: `baitbuster-worker/package.json`

**Interfaces:**
- Produces: `normalizeStory(input) -> Story | null`
- Produces: `storyCacheKey(story) -> Promise<string>`
- Produces: `sanitizeClassificationResult(value, knownKeys) -> ClassificationResult[]`
- Produces: `sanitizeRewriteResult(value, story) -> RewriteResult`
- Produces: `originalResult(story, status) -> BaitBusterResult`

- [ ] **Step 1: Write failing core tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStory,
  storyCacheKey,
  sanitizeClassificationResult,
  sanitizeRewriteResult,
  originalResult
} from "../src/core.js";

test("normalizeStory keeps only required safe story fields",()=>{
  assert.deepEqual(normalizeStory({
    key:"abc",
    url:"https://example.com/a",
    title:"  Başlık  ",
    description:"  Açıklama ",
    source:"Kaynak",
    category:"Gündem",
    ignored:"x"
  }),{
    key:"abc",
    url:"https://example.com/a",
    title:"Başlık",
    description:"Açıklama",
    source:"Kaynak",
    category:"Gündem"
  });
});

test("normalizeStory rejects unusable stories",()=>{
  assert.equal(normalizeStory({url:"https://example.com",title:""}),null);
  assert.equal(normalizeStory({url:"javascript:alert(1)",title:"Başlık"}),null);
});

test("storyCacheKey is stable for same url and original title",async()=>{
  const story=normalizeStory({url:"https://example.com/a",title:"Başlık"});
  assert.equal(await storyCacheKey(story),await storyCacheKey(story));
});

test("classification sanitizer drops unknown keys and clamps confidence",()=>{
  const rows=sanitizeClassificationResult([
    {key:"a",clickbait:true,confidence:4,needsArticle:true,reasonCode:"withheld_core_fact"},
    {key:"x",clickbait:true,confidence:.8,needsArticle:true,reasonCode:"x"}
  ],new Set(["a"]));
  assert.equal(rows.length,1);
  assert.equal(rows[0].key,"a");
  assert.equal(rows[0].confidence,1);
});

test("rewrite sanitizer refuses empty rewritten titles",()=>{
  const story=normalizeStory({key:"a",url:"https://example.com/a",title:"Orijinal"});
  assert.equal(sanitizeRewriteResult({rewriteStatus:"rewritten",flowTitle:""},story).flowTitle,null);
});

test("originalResult always preserves original title",()=>{
  const story=normalizeStory({key:"a",url:"https://example.com/a",title:"Orijinal"});
  assert.equal(originalResult(story,"ai_error").originalTitle,"Orijinal");
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: FAIL because `src/core.js` does not exist yet.

- [ ] **Step 3: Implement the minimal pure core**

`package.json`:

```json
{
  "name": "thefloew-baitbuster-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

`core.js` must:

```js
export function normalizeStory(input){
  if(!input||typeof input!=="object")return null;
  const title=String(input.title||"").trim().slice(0,700);
  const rawUrl=String(input.url||"").trim();
  if(!title||!rawUrl)return null;
  let url;
  try{ url=new URL(rawUrl); }catch{ return null; }
  if(url.protocol!=="https:"&&url.protocol!=="http:")return null;
  return {
    key:String(input.key||rawUrl).trim().slice(0,900),
    url:url.href,
    title,
    description:String(input.description||"").trim().slice(0,1800),
    source:String(input.source||"").trim().slice(0,180),
    category:String(input.category||"").trim().slice(0,120)
  };
}

export async function storyCacheKey(story){
  const text=`${story.url}\n${story.title}`;
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,"0")).join("");
}

export function clamp01(value){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):0;
}
```

Add strict sanitizer functions matching the tests and the result contract from the spec. Unknown reason codes may be preserved as short strings because they are diagnostic only; status values must be restricted to `rewritten`, `not_clickbait`, `insufficient_content`, `article_error`, `ai_error` and `invalid_story`.

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: all core tests PASS.

- [ ] **Step 5: Commit**

```bash
git add baitbuster-worker/package.json baitbuster-worker/src/core.js baitbuster-worker/test/core.test.mjs
git commit -m "feat: add BaitBuster core contract"
```

---

### Task 2: Safe Article Fetch and Text Extraction

**Files:**
- Create: `baitbuster-worker/src/article.js`
- Create: `baitbuster-worker/test/article.test.mjs`

**Interfaces:**
- Consumes: normalized `story.url`
- Produces: `isSafeArticleUrl(url) -> boolean`
- Produces: `cleanArticleText(text) -> string`
- Produces: `fetchArticleText(url, fetchImpl=fetch) -> Promise<string>`

- [ ] **Step 1: Write failing article tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {isSafeArticleUrl,cleanArticleText} from "../src/article.js";

test("article url rejects localhost and private ip literals",()=>{
  for(const url of [
    "http://localhost/a",
    "http://127.0.0.1/a",
    "http://10.0.0.1/a",
    "http://192.168.1.2/a",
    "http://169.254.1.1/a",
    "http://[::1]/a"
  ]) assert.equal(isSafeArticleUrl(url),false,url);
});

test("article url allows ordinary public http(s) urls",()=>{
  assert.equal(isSafeArticleUrl("https://example.com/news/1"),true);
});

test("cleanArticleText collapses whitespace and limits size",()=>{
  const cleaned=cleanArticleText("  Bir   haber\n\n metni  ");
  assert.equal(cleaned,"Bir haber metni");
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
cd baitbuster-worker && node --test test/article.test.mjs
```

Expected: FAIL because `src/article.js` does not exist.

- [ ] **Step 3: Implement URL safety and extraction**

`isSafeArticleUrl` must reject:

```text
localhost
*.localhost
*.local
0.0.0.0/8
10.0.0.0/8
127.0.0.0/8
169.254.0.0/16
172.16.0.0/12
192.168.0.0/16
::1
fc00::/7
fe80::/10
```

`fetchArticleText` must:

1. accept only `http:`/`https:` URLs passing `isSafeArticleUrl`;
2. use `redirect:"manual"` and revalidate every redirect target;
3. stop after 4 redirects;
4. abort after 8 seconds;
5. reject non-HTML content types;
6. reject responses larger than 2 MB by `content-length` when available;
7. read at most 2 MB of body data;
8. remove `script`, `style`, `noscript`, `svg`, `nav`, `footer`, `header`, `form` blocks;
9. prefer text found inside `<article>` and `<main>` when present, otherwise fall back to body paragraph text;
10. return at most 18,000 normalized characters.

Keep extraction dependency-free for the beta. Use conservative HTML stripping rather than introducing a full parser into the Worker bundle.

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: all Task 1 and Task 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add baitbuster-worker/src/article.js baitbuster-worker/test/article.test.mjs
git commit -m "feat: add safe BaitBuster article extraction"
```

---

### Task 3: OpenAI Structured Classification and Rewrite

**Files:**
- Create: `baitbuster-worker/src/openai.js`
- Extend: `baitbuster-worker/test/core.test.mjs`

**Interfaces:**
- Produces: `classifyStories(stories, env, fetchImpl=fetch) -> Promise<ClassificationResult[]>`
- Produces: `rewriteStory(story, articleText, env, fetchImpl=fetch) -> Promise<RewriteResult>`
- Requires Worker secret: `OPENAI_API_KEY`
- Optional Worker variable: `OPENAI_MODEL`, default `gpt-5.6-luna`

- [ ] **Step 1: Add response-parsing tests**

Add pure exported helper `extractStructuredOutput(responseJson)` and tests covering:

```js
test("structured output extractor reads output_text JSON",()=>{
  const payload={output:[{content:[{type:"output_text",text:'{"results":[]}'}]}]};
  assert.deepEqual(extractStructuredOutput(payload),{results:[]});
});

test("structured output extractor rejects malformed JSON",()=>{
  assert.throws(()=>extractStructuredOutput({output:[{content:[{type:"output_text",text:"nope"}]}]}));
});
```

- [ ] **Step 2: Run the new tests and verify failure**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: FAIL because `openai.js` is missing.

- [ ] **Step 3: Implement the OpenAI REST client**

Use `POST https://api.openai.com/v1/responses` with:

```js
{
  model: env.OPENAI_MODEL || "gpt-5.6-luna",
  reasoning: {effort:"none"},
  input: [
    {role:"system",content:[{type:"input_text",text:SYSTEM_PROMPT}]},
    {role:"user",content:[{type:"input_text",text:JSON.stringify(payload)}]}
  ],
  text: {
    format: {
      type:"json_schema",
      name:"baitbuster_result",
      strict:true,
      schema: schemaObject
    }
  }
}
```

Classification schema must require an array `results`, each item containing exactly:

```json
{
  "key": "string",
  "clickbait": true,
  "confidence": 0.0,
  "needsArticle": true,
  "reasonCode": "string"
}
```

The classifier system prompt must explicitly say:

```text
Evaluate meaning, not keyword matches. Mark clickbait only when the headline materially withholds the core fact, creates an artificial curiosity gap, substitutes emotional shock for the event itself, or otherwise prevents the reader from knowing the central news fact from the headline. Do not penalize concise breaking-news headlines merely for being short. Do not rewrite in this step.
```

Rewrite schema must require exactly:

```json
{
  "rewriteStatus": "rewritten | insufficient_content",
  "flowTitle": "string or null",
  "confidence": 0.0
}
```

The rewrite system prompt must explicitly say:

```text
Use only facts present in the supplied article text. Never infer motives, causes, numbers, identities or outcomes that are not explicit. If the article text does not reveal the fact hidden by the original headline, return insufficient_content. If rewritten, write a neutral Turkish news headline that states the subject and central event directly, normally in 8-15 words.
```

Set an 18 second timeout for OpenAI calls and throw on non-2xx responses, refusals, malformed structured output, or missing required fields. The caller will convert those errors to original-title fallbacks.

- [ ] **Step 4: Run all Worker tests**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add baitbuster-worker/src/openai.js baitbuster-worker/test/core.test.mjs
git commit -m "feat: add BaitBuster AI classification and rewrite"
```

---

### Task 4: Cloudflare Worker Route, KV Cache and Failure Isolation

**Files:**
- Create: `baitbuster-worker/src/index.js`
- Create: `docs/baitbuster-worker-deploy.md`

**Interfaces:**
- Route: `GET /health`
- Route: `POST /v1/evaluate`
- Request body: `{ "stories": Story[] }`, maximum 12 stories
- Response body: `{ "ok": true, "results": BaitBusterResult[] }`
- KV binding name: `BAITBUSTER_CACHE`
- Worker secret: `OPENAI_API_KEY`
- Worker name: `thefloew-baitbuster`

- [ ] **Step 1: Implement CORS and health route**

Allowed production origin:

```text
https://xn--flw-tna.tr
```

Allow `OPTIONS` and `POST`, content type `application/json`, and no credentials. Unknown origins receive no permissive CORS header.

`GET /health` returns:

```json
{
  "ok": true,
  "service": "thefloew-baitbuster",
  "version": "1.0.0"
}
```

- [ ] **Step 2: Implement cache-first evaluate flow**

For each normalized story:

```js
const cacheKey=`v1:${await storyCacheKey(story)}`;
const cached=await env.BAITBUSTER_CACHE.get(cacheKey,"json");
```

Uncached stories are classified in one metadata batch of up to 12. For classifier rows with `clickbait === false` or `needsArticle === false`, store a `not_clickbait` result. For suspicious rows, fetch article text and rewrite with concurrency 3.

Write successful terminal results to KV with:

```js
await env.BAITBUSTER_CACHE.put(cacheKey,JSON.stringify(result),{
  expirationTtl:30*24*60*60
});
```

Do not cache transient `ai_error` or `article_error` longer than the request lifetime; they should retry on a later visit.

- [ ] **Step 3: Make every per-story failure degrade to original title**

Use `Promise.allSettled` for article/rewrite work. One broken source must not fail the batch. A response should still be HTTP 200 with result rows where possible.

Only malformed top-level requests receive HTTP 400. Missing `OPENAI_API_KEY` or missing `BAITBUSTER_CACHE` receive HTTP 503 with a short machine-readable error because deployment is incomplete.

- [ ] **Step 4: Write the deployment document**

`docs/baitbuster-worker-deploy.md` must state exactly:

```text
Worker name: thefloew-baitbuster
Production URL: https://thefloew-baitbuster.thefloewback.workers.dev
KV binding variable: BAITBUSTER_CACHE
Secret: OPENAI_API_KEY
Optional text variable: OPENAI_MODEL=gpt-5.6-luna
Allowed site origin: https://xn--flw-tna.tr
```

Dashboard procedure:

1. Cloudflare Workers & Pages → Create Worker → name `thefloew-baitbuster`.
2. Paste/deploy `baitbuster-worker/src/index.js` together with its imported `core.js`, `article.js`, and `openai.js` using the Worker editor/modules workflow, or deploy the folder with Wrangler if preferred.
3. Create a Workers KV namespace named `thefloew-baitbuster-cache`.
4. Bind that namespace to the Worker as `BAITBUSTER_CACHE`.
5. Add secret `OPENAI_API_KEY`.
6. Add optional variable `OPENAI_MODEL` with value `gpt-5.6-luna`.
7. Deploy and verify `GET /health`.

- [ ] **Step 5: Re-run pure tests before integration**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add baitbuster-worker/src/index.js docs/baitbuster-worker-deploy.md
git commit -m "feat: add BaitBuster Cloudflare Worker API"
```

---

### Task 5: Beta Client Background Evaluation

**Files:**
- Create: `js/baitbuster-beta.js`
- Modify: `baitbusterbeta/index.html`

**Interfaces:**
- Consumes Worker endpoint: `POST https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate`
- Reads visible story metadata from each `.slide`
- Writes only DOM presentation state; does not mutate Flöw story objects

- [ ] **Step 1: Add beta-only script load**

At the bottom of `baitbusterbeta/index.html`, after the current `feedback.js` script, add:

```html
<script src="js/baitbuster-beta.js?v=1"></script>
```

Because the page has `<base href="/">`, this resolves to the root `js/` folder.

- [ ] **Step 2: Implement story extraction from a slide**

`readSlideStory(slide)` returns null unless all required fields are available. Read:

```js
const title=slide.querySelector("h1")?.dataset.baitbusterOriginalTitle || slide.querySelector("h1")?.textContent;
const description=slide.querySelector(".description")?.textContent;
const source=slide.querySelector(".source")?.textContent;
const category=slide.querySelector(".category")?.textContent;
const url=slide.querySelector(".source-link")?.href;
```

The key is `${url}|${title}`.

- [ ] **Step 3: Add non-blocking batch queue**

Use a `MutationObserver` watching `#a` and `#b` with `{subtree:true,childList:true,characterData:true,attributes:true}`. Debounce queue flush by 180 ms. Send up to 12 unseen stories in one request. Keep in-memory sets for `pendingKeys` and `completedKeys` so re-rendering does not create duplicate requests in the same page session.

Do not alter the loading screen or initial app startup. All evaluation begins only after slides already contain story data.

- [ ] **Step 4: Apply rewritten titles safely**

When result is `rewriteStatus === "rewritten"` and `flowTitle` is non-empty:

```js
const heading=slide.querySelector("h1");
if(!heading.dataset.baitbusterOriginalTitle){
  heading.dataset.baitbusterOriginalTitle=heading.textContent.trim();
}
heading.textContent=result.flowTitle.trim();
heading.dataset.baitbusterApplied="1";
```

Add a sibling marker:

```html
<span class="baitbuster-rewrite-mark" title="BaitBuster β tarafından sadeleştirildi" aria-label="BaitBuster beta tarafından sadeleştirildi">✦</span>
```

If the same slide is later reused for a different story, clear stale marker/data before evaluating the new story.

- [ ] **Step 5: Add beta marker styling**

Add to the existing beta-only `<style id="baitbuster-beta-style">` block:

```css
.baitbuster-rewrite-mark{
  display:inline-block;
  margin-left:.42em;
  font-size:.55em;
  vertical-align:.28em;
  opacity:.72;
  font-family:system-ui,sans-serif;
}
```

Do not change shared `css/styles.css` in this iteration.

- [ ] **Step 6: Add browser-side failure behavior**

Fetch timeout: 20 seconds. On any network/JSON/API error, leave the DOM unchanged and remove the key only from `pendingKeys` so a later render can retry. Never show a user-facing error banner for BaitBuster failures during beta.

- [ ] **Step 7: Commit**

```bash
git add js/baitbuster-beta.js baitbusterbeta/index.html
git commit -m "feat: connect BaitBuster beta client"
```

---

### Task 6: Preserve Original Headline in Share Flow

**Files:**
- Modify: `js/share.js`

**Interfaces:**
- Consumes optional `data-baitbuster-original-title` on slide `h1`
- Existing share behavior remains unchanged when the data attribute is absent

- [ ] **Step 1: Change only the DOM fallback title extraction**

Where `share.js` currently reads:

```js
slide.querySelector("h1")?.textContent
```

change the fallback to:

```js
slide.querySelector("h1")?.dataset?.baitbusterOriginalTitle ||
slide.querySelector("h1")?.textContent
```

Do not alter any story-object title preference already present above this fallback.

- [ ] **Step 2: Verify main-site compatibility by inspection**

Confirm that ordinary `index.html` never sets `data-baitbuster-original-title`, so the expression resolves to the exact existing `textContent` behavior on the main site.

- [ ] **Step 3: Commit**

```bash
git add js/share.js
git commit -m "fix: preserve original title when sharing BaitBuster stories"
```

---

### Task 7: End-to-End Beta Verification

**Files:**
- No new files required unless a defect is found.

**Interfaces:**
- Verifies deployed Worker plus live beta page.

- [ ] **Step 1: Verify unit tests**

Run:

```bash
cd baitbuster-worker && node --test
```

Expected: 0 failed tests.

- [ ] **Step 2: Verify Worker health**

Run:

```bash
curl -i https://thefloew-baitbuster.thefloewback.workers.dev/health
```

Expected: HTTP 200 and JSON containing `"ok":true`.

- [ ] **Step 3: Verify CORS preflight**

Run:

```bash
curl -i -X OPTIONS \
  -H 'Origin: https://xn--flw-tna.tr' \
  -H 'Access-Control-Request-Method: POST' \
  https://thefloew-baitbuster.thefloewback.workers.dev/v1/evaluate
```

Expected: 204 with `Access-Control-Allow-Origin: https://xn--flw-tna.tr`.

- [ ] **Step 4: Verify a normal headline remains unchanged**

POST a clearly factual test story such as:

```json
{
  "stories":[{
    "key":"test-normal",
    "url":"https://example.com/news",
    "title":"Merkez Bankası politika faizini yüzde 40'ta sabit tuttu",
    "description":"Para Politikası Kurulu faiz kararını açıkladı.",
    "source":"Test",
    "category":"Ekonomi"
  }]
}
```

Expected: `rewriteStatus:"not_clickbait"` or, if article verification is requested and unavailable for the synthetic URL, no fabricated `flowTitle`.

- [ ] **Step 5: Verify a clickbait-shaped real-source story**

Use one live Flöw story whose headline hides the central fact. Expected: if article text reveals the missing fact, response is `rewriteStatus:"rewritten"` with a non-empty `flowTitle`; if article text cannot be extracted, response falls back without inventing a title.

- [ ] **Step 6: Verify the beta page remains responsive while AI is pending**

Open `https://flöw.tr/baitbusterbeta/` with network tools visible. Confirm the first story renders before `/v1/evaluate` finishes and swiping continues normally while the request is in flight.

- [ ] **Step 7: Verify rewritten visual and original share title**

On a rewritten story, confirm `✦` appears beside the visual headline. Trigger Share and confirm share text uses the original publisher headline, not `flowTitle`.

- [ ] **Step 8: Verify main site regression boundary**

Open `https://flöw.tr/`. Confirm there are no BaitBuster network requests, no `✦` markers, and headlines/share behavior match the pre-beta site.

- [ ] **Step 9: Compare the feature branch against main before merge**

Expected changed runtime files are limited to:

```text
baitbuster-worker/**
js/baitbuster-beta.js
baitbusterbeta/index.html
js/share.js
docs/baitbuster-worker-deploy.md
docs/superpowers/specs/2026-09-17-baitbuster-beta-design.md
docs/superpowers/plans/2026-09-17-baitbuster-beta.md
```

- [ ] **Step 10: Merge only after live beta verification**

Fast-forward `main` to the verified feature-branch commit only after the Worker is deployed and the beta acceptance checks above pass.
