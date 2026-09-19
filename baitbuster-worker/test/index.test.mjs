import test from "node:test";
import assert from "node:assert/strict";
import {handleRequest} from "../src/index.js";
import {normalizeStory,storyCacheKey,originalResult} from "../src/core.js";

const ORIGIN="https://xn--flw-tna.tr";

test("health is public and reports service version",async()=>{
  const res=await handleRequest(new Request("https://worker.test/health"),{},{});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,service:"thefloew-baitbuster",version:"1.0.0"});
});

test("preflight allows only Flöw production origin",async()=>{
  const allowed=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"OPTIONS",headers:{Origin:ORIGIN}
  }),{},{});
  assert.equal(allowed.status,204);
  assert.equal(allowed.headers.get("access-control-allow-origin"),ORIGIN);

  const denied=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"OPTIONS",headers:{Origin:"https://evil.example"}
  }),{},{});
  assert.equal(denied.status,403);
  assert.equal(denied.headers.get("access-control-allow-origin"),null);
});

test("evaluate rejects wrong origin before spending AI resources",async()=>{
  const res=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"POST",
    headers:{Origin:"https://evil.example","Content-Type":"application/json"},
    body:JSON.stringify({stories:[{key:"a",url:"https://example.com/a",title:"Başlık"}]})
  }),{AI:{run:async()=>({response:{results:[]}})},BAITBUSTER_CACHE:{}},{});
  assert.equal(res.status,403);
});

test("evaluate reports incomplete deployment",async()=>{
  const res=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"POST",
    headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({stories:[{key:"a",url:"https://example.com/a",title:"Başlık"}]})
  }),{},{});
  assert.equal(res.status,503);
  assert.equal((await res.json()).error,"service_not_configured");
});

test("cached story returns without an OpenAI call",async()=>{
  const story=normalizeStory({key:"a",url:"https://example.com/a",title:"Normal başlık"});
  const cacheKey=`v1:${await storyCacheKey(story)}`;
  const cached=originalResult(story,"not_clickbait",{classificationConfidence:.9,modelVersion:"test"});
  const env={
    OPENAI_API_KEY:"unused",
    BAITBUSTER_CACHE:{
      async get(key,type){
        assert.equal(type,"json");
        return key===cacheKey?cached:null;
      },
      async put(){throw new Error("put should not be called for cache hit");}
    }
  };
  const res=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"POST",
    headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({stories:[story]})
  }),env,{});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.ok,true);
  assert.equal(body.results[0].originalTitle,"Normal başlık");
  assert.equal(body.results[0].rewriteStatus,"not_clickbait");
});
