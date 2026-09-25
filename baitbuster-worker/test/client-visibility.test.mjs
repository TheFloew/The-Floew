import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const clientUrl=new URL("../../js/baitbuster-beta.js",import.meta.url);

async function clientSource(){
  return readFile(clientUrl,"utf8");
}

test("BaitBuster gives the current story its own fast lane and prefetches only the next two",async()=>{
  const client=await clientSource();
  assert.match(client,/const PREFETCH_COUNT=2;/);
  assert.match(client,/const foregroundQueue=new Map\(\);/);
  assert.match(client,/const prefetchQueue=new Map\(\);/);
  assert.match(client,/function queueStateWindow\(\)/);
  assert.match(client,/flushForegroundQueue\(\)/);
  assert.match(client,/flushPrefetchQueue\(\)/);
});

test("state-backed priority window cannot be expanded by rendered slide fallbacks",async()=>{
  const client=await clientSource();
  assert.match(client,/const queuedFromState=queueStateWindow\(\);/);
  assert.match(
    client,
    /const cachedResult=resultByKey\.get\(story\.key\);[\s\S]*?if\(queuedFromState\)continue;/
  );
});

test("slide reuse clears stale BaitBuster presentation before debounce",async()=>{
  const client=await clientSource();
  assert.match(
    client,
    /function handleSlideMutations\(records\)[\s\S]*?resetIfSlideReused\(slide\)[\s\S]*?scheduleScan\(\)/
  );
  assert.match(client,/new MutationObserver\(handleSlideMutations\)/);
});

test("BaitBuster refuses to scan or post while the page is hidden",async()=>{
  const client=await clientSource();
  assert.match(
    client,
    /function isPageVisible\(\)\s*\{[\s\S]*?document\.visibilityState==="visible"/
  );
  assert.match(
    client,
    /async function flushLane\([^)]*\)\s*\{[\s\S]*?!isPageVisible\(\)/
  );
  assert.match(
    client,
    /function scanSlides\(\)\s*\{[\s\S]*?!isPageVisible\(\)/
  );
  assert.match(
    client,
    /function scheduleScan\(\)\s*\{[\s\S]*?!isPageVisible\(\)/
  );
});

test("BaitBuster aborts hidden-page work and resumes when visible",async()=>{
  const client=await clientSource();
  assert.match(
    client,
    /document\.addEventListener\("visibilitychange"[\s\S]*?foregroundQueue\.clear\(\)[\s\S]*?prefetchQueue\.clear\(\)[\s\S]*?requestState\.foreground\.controller\?\.abort\(\)[\s\S]*?requestState\.prefetch\.controller\?\.abort\(\)[\s\S]*?scheduleScan\(\)/
  );
});

test("production and beta pages cache-bust the visibility-aware client",async()=>{
  const [production,beta]=await Promise.all([
    readFile(new URL("../../index.html",import.meta.url),"utf8"),
    readFile(new URL("../../baitbusterbeta/index.html",import.meta.url),"utf8")
  ]);
  assert.match(production,/js\/baitbuster-beta\.js\?v=13/);
  assert.match(beta,/js\/baitbuster-beta\.js\?v=13/);
});
