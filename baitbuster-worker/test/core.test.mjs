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
    {key:"a",clickbait:true,confidence:4,needsArticle:false,reasonCode:"withheld_core_fact",missingQuestion:"Ne açıkladı?",candidateFact:"Test sonuçlarını paylaşacağını söyledi."},
    {key:"x",clickbait:true,confidence:.8,needsArticle:true,reasonCode:"x",missingQuestion:"?",candidateFact:""}
  ],new Set(["a"]));
  assert.equal(rows.length,1);
  assert.equal(rows[0].key,"a");
  assert.equal(rows[0].confidence,1);
  assert.equal(rows[0].missingQuestion,"Ne açıkladı?");
  assert.equal(rows[0].candidateFact,"Test sonuçlarını paylaşacağını söyledi.");
});

test("rewrite sanitizer refuses empty rewritten titles",()=>{
  const story=normalizeStory({key:"a",url:"https://example.com/a",title:"Orijinal"});
  assert.equal(sanitizeRewriteResult({
    rewriteStatus:"rewritten",
    flowTitle:"",
    confidence:.9,
    informationGain:.8,
    addedInformation:["Yeni bilgi"]
  },story).flowTitle,null);
});

test("rewrite sanitizer rejects paraphrases without material information gain",()=>{
  const story=normalizeStory({
    key:"a",
    url:"https://example.com/a",
    title:"Şarkıcı Sefo'dan ilk açıklama"
  });
  const result=sanitizeRewriteResult({
    rewriteStatus:"rewritten",
    flowTitle:"Sefo soruşturma sonrası ilk açıklamasını yaptı",
    confidence:.94,
    informationGain:.12,
    addedInformation:[]
  },story);
  assert.equal(result.rewriteStatus,"insufficient_content");
  assert.equal(result.flowTitle,null);
});

test("rewrite sanitizer rejects confident paraphrases that add no concrete fact",()=>{
  const story=normalizeStory({
    key:"a",
    url:"https://example.com/a",
    title:"Şarkıcı Sefo'dan ilk açıklama"
  });
  const result=sanitizeRewriteResult({
    rewriteStatus:"rewritten",
    flowTitle:"Sefo ilk açıklamasını yaptı",
    confidence:.97,
    informationGain:.91,
    addedInformation:["Sefo ilk açıklamasını yaptı"]
  },story);
  assert.equal(result.rewriteStatus,"insufficient_content");
  assert.equal(result.flowTitle,null);
});

test("rewrite sanitizer accepts a materially informative headline",()=>{
  const story=normalizeStory({
    key:"a",
    url:"https://example.com/a",
    title:"Şarkıcı Sefo'dan ilk açıklama"
  });
  const result=sanitizeRewriteResult({
    rewriteStatus:"rewritten",
    flowTitle:"Sefo, bağımsız merkezde de test verdiğini ve sonuçları paylaşacağını açıkladı",
    confidence:.94,
    informationGain:.78,
    addedInformation:[
      "Bağımsız bir merkezde de test verdi",
      "Test sonuçlarını paylaşacağını söyledi"
    ]
  },story);
  assert.equal(result.rewriteStatus,"rewritten");
  assert.equal(result.informationGain,.78);
  assert.equal(result.addedInformation.length,2);
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
