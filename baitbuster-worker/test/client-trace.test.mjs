import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

async function source(path){
  return readFile(new URL(`../../${path}`,import.meta.url),"utf8");
}

test("BaitBuster requests identify client type and client version",async()=>{
  const client=await source("js/baitbuster-beta.js");
  assert.match(client,/const CLIENT_VERSION="12";/);
  assert.match(client,/X-BaitBuster-Client/);
  assert.match(client,/X-BaitBuster-Version/);
  assert.match(client,/FloewIOS/);
  assert.match(client,/android-app/);
  assert.match(client,/android-tv/);
  assert.match(client,/return "web"/);
});

test("BaitBuster Worker CORS allows trace headers",async()=>{
  const worker=await source("baitbuster-worker/src/index.js");
  assert.match(
    worker,
    /Access-Control-Allow-Headers[^\n]*Content-Type, X-BaitBuster-Client, X-BaitBuster-Version/
  );
});

test("production pages cache-bust traced BaitBuster client",async()=>{
  const [production,beta]=await Promise.all([
    source("index.html"),
    source("baitbusterbeta/index.html")
  ]);
  assert.match(production,/js\/baitbuster-beta\.js\?v=12/);
  assert.match(beta,/js\/baitbuster-beta\.js\?v=12/);
});
