import test from "node:test";
import assert from "node:assert/strict";
import {handleRequest} from "../src/index.js";
import {normalizeStory,storyCacheKey,originalResult} from "../src/core.js";

const ORIGIN="https://xn--flw-tna.tr";

test("health is public and reports service version",async()=>{
  const res=await handleRequest(new Request("https://worker.test/health"),{},{});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{ok:true,service:"thefloew-baitbuster",version:"1.6.5"});
});

test("preflight allows only Flöw production origin",async()=>{
  const allowed=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"OPTIONS",headers:{Origin:ORIGIN}
  }),{},{});
  assert.equal(allowed.status,204);
  assert.equal(allowed.headers.get("access-control-allow-origin"),ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-headers"),"Content-Type, X-BaitBuster-Client, X-BaitBuster-Version");

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

test("cached story returns without a Workers AI call",async()=>{
  const story=normalizeStory({key:"a",url:"https://example.com/a",title:"Normal başlık"});
  const cacheKey=`v6:${await storyCacheKey(story)}`;
  const cached=originalResult(story,"not_clickbait",{classificationConfidence:.9,modelVersion:"test"});
  const env={
    AI:{run:async()=>{throw new Error("AI should not be called for cache hit");}},
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


test("high-confidence 8B gate result is returned and cached without a 70B call",async()=>{
  const calls=[];
  const writes=[];
  const env={
    AI:{
      async run(model,input){
        calls.push(model);
        return {response:"0|clear|0.95"};
      }
    },
    BAITBUSTER_CACHE:{
      async get(){return null;},
      async put(key,value){writes.push({key,value:JSON.parse(value)});}
    }
  };
  const res=await handleRequest(new Request("https://worker.test/v1/evaluate",{
    method:"POST",
    headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({stories:[{
      key:"gate-clear",
      url:"https://example.com/gate-clear",
      title:"Merkez Bankası politika faizini yüzde 42,5'e indirdi",
      description:"Faiz kararı açıklandı.",
      source:"Kaynak",
      category:"Gündem"
    }]})
  }),env,{});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(calls.length,1);
  assert.equal(calls[0],"@cf/meta/llama-3.1-8b-instruct-fp8");
  assert.equal(body.results[0].rewriteStatus,"not_clickbait");
  assert.equal(body.results[0].modelVersion,"@cf/meta/llama-3.1-8b-instruct-fp8");
  assert.equal(writes.length,1);
});


test("article-image route is limited to Turkish Sputnik",async()=>{
  const res=await handleRequest(new Request("https://worker.test/v1/article-image",{
    method:"POST",
    headers:{Origin:ORIGIN,"Content-Type":"application/json"},
    body:JSON.stringify({url:"https://example.com/news"})
  }),{},{});

  assert.equal(res.status,400);
  assert.equal((await res.json()).error,"unsupported_source");
});

test("article-image route returns the clean Sputnik hero URL without AI bindings",async()=>{
  const clean="https://cdn.img.anlatilaninotesi.com.tr/img/07ea/09/19/1109053747_0:160:3072:1888_1920x0_80_0_0_a70aba764b501c8ac4c1b74cd6001bf2.jpg.webp";
  const html=`<article><figure class="article-media photo"><img src="${clean}" width="1920" height="1080"></figure></article>`;
  const realFetch=globalThis.fetch;

  globalThis.fetch=async()=>new Response(html,{
    status:200,
    headers:{"Content-Type":"text/html; charset=utf-8"}
  });

  try{
    const res=await handleRequest(new Request("https://worker.test/v1/article-image",{
      method:"POST",
      headers:{Origin:ORIGIN,"Content-Type":"application/json"},
      body:JSON.stringify({
        url:"https://anlatilaninotesi.com.tr/20260925/test-1109055337.html"
      })
    }),{},{});

    assert.equal(res.status,200);
    assert.deepEqual(await res.json(),{ok:true,imageUrl:clean});
  }finally{
    globalThis.fetch=realFetch;
  }
});
