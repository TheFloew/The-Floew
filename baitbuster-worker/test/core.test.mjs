import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStory,
  storyCacheKey,
  sanitizeClassificationResult,
  sanitizeRewriteResult,
  originalResult
} from "../src/core.js";
import {extractWorkersAIObject} from "../src/ai.js";

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


test("Workers AI extractor reads JSON mode response objects",()=>{
  assert.deepEqual(
    extractWorkersAIObject({response:{results:[]}}),
    {results:[]}
  );
});

test("Workers AI extractor parses string responses",()=>{
  assert.deepEqual(
    extractWorkersAIObject({response:'{"results":[]}'}),
    {results:[]}
  );
});

test("Workers AI extractor rejects malformed output",()=>{
  assert.throws(()=>extractWorkersAIObject({response:"not-json"}));
});
