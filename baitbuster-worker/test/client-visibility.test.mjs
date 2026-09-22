import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const clientUrl=new URL("../../js/baitbuster-beta.js",import.meta.url);

async function clientSource(){
  return readFile(clientUrl,"utf8");
}

test("BaitBuster limits prefetch to current story plus next two",async()=>{
  const client=await clientSource();
  assert.match(client,/const MAX_BATCH=3;/);
});

test("state-backed prefetch window cannot be expanded by rendered slide fallbacks",async()=>{
  const client=await clientSource();
  assert.match(client,/const queuedFromState=queueUpcomingStories\(\);/);
  assert.match(
    client,
    /const cachedResult=resultByKey\.get\(story\.key\);[\s\S]*?if\(queuedFromState\)continue;[\s\S]*?queued\.set\(story\.key,story\);/
  );
});

test("BaitBuster refuses to scan or post while the page is hidden",async()=>{
  const client=await clientSource();
  assert.match(
    client,
    /function isPageVisible\(\)\s*\{[\s\S]*?document\.visibilityState==="visible"/
  );
  assert.match(
    client,
    /async function flushQueue\(\)\s*\{[\s\S]*?!isPageVisible\(\)/
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
    /document\.addEventListener\("visibilitychange"[\s\S]*?queued\.clear\(\)[\s\S]*?activeController\?\.abort\(\)[\s\S]*?scheduleScan\(\)/
  );
});

test("production and beta pages cache-bust the visibility-aware client",async()=>{
  const [production,beta]=await Promise.all([
    readFile(new URL("../../index.html",import.meta.url),"utf8"),
    readFile(new URL("../../baitbusterbeta/index.html",import.meta.url),"utf8")
  ]);
  assert.match(production,/js\/baitbuster-beta\.js\?v=12/);
  assert.match(beta,/js\/baitbuster-beta\.js\?v=12/);
});
