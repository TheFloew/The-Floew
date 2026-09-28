import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

async function source(path){
  return readFile(new URL(`../../${path}`,import.meta.url),"utf8");
}

test("BaitBuster exposes an explicit pre-display preparation API",async()=>{
  const client=await source("js/baitbuster-beta.js");
  assert.match(client,/globalThis\.BaitBusterBeta=/);
  assert.match(client,/prepareStory,/);
  assert.match(client,/prepareAndApply,/);
  assert.match(client,/applyToSlide,/);
  assert.match(client,/prefetchStories,/);
  assert.match(client,/resolveArticleImage,/);
});

test("BaitBuster no longer relies on a DOM MutationObserver",async()=>{
  const client=await source("js/baitbuster-beta.js");
  assert.doesNotMatch(client,/new MutationObserver/);
});

test("Flöw fully prepares a story before the main transition starts",async()=>{
  const app=await source("js/app.js");
  assert.match(app,/async function prepareStorySlideInternal/);
  assert.match(
    app,
    /async function transitionTo\([\s\S]*?await prepareTransitionSlide\(nextSlide,story\)[\s\S]*?nextSlide\.classList\.add\(enterClass\)/
  );
});

test("the initial story is prepared behind the loading screen",async()=>{
  const app=await source("js/app.js");
  assert.match(
    app,
    /if\(!state\.stories\.length\)[\s\S]*?await prepareStorySlide\([\s\S]*?slides\[0\][\s\S]*?finishInitialLoading\(\)/
  );
});

test("the obsolete baitbusterbeta page is not part of production loading",async()=>{
  const production=await source("index.html");
  assert.doesNotMatch(production,/baitbusterbeta\//);
  assert.match(production,/js\/baitbuster-beta\.js\?v=[a-f0-9]{12}/);
});
